import { ORBIT_MS, makeEnvelope, operatorOfHabitat, payloadSchemas, type Ctx, type Envelope, type PayloadOf, type ServiceDeps } from "@sudsnik/contracts";
import { CANCELLABLE_STATES, type Order, type OrderFilter, type PlaceOrder } from "@sudsnik/contracts/services/orders";
import type { Outbox } from "@sudsnik/infra-queue";
import { err, newId, ok, sudsnikError, type Result, type SudsnikError } from "@sudsnik/kernel";
import type { OrdersPort } from "../port.js";
import { nextState, type Trigger } from "../stateMachine.js";
import type { EventSink } from "./eventSink.js";
import type { OrderRepository } from "./OrderRepository.js";

const transitionTopics = {
  "pickup.scheduled": true,
  "hold.expired": true,
  "pod.collected": true,
  "pod.delivered": true,
  "wash.started": true,
  "wash.faulted": true,
  "wash.completed": true,
  "pickup.failed": true,
  "return.scheduled": true,
  "pod.returned": true,
} as const;

type ConsumedTopic = keyof typeof transitionTopics;

const paymentOf = { "charge.captured": "captured", "charge.failed": "failed", "refund.issued": "refunded" } as const;

interface Cause {
  correlationId: string;
  causationId?: string;
}

/** What a variant decides "have I applied this already?" from. */
export interface EventClaim {
  envelope: Envelope;
  orderId: string;
  now: number;
}

/** Compensation names carried by order.cancelled; dispatch acts on release-hold, this service on refund. */
export const COMPENSATION = { refund: "refund", releaseHold: "release-hold" } as const;

/** Who ended the order: the cancel command, or the compensation this service runs after giving up on it. */
export const ORIGIN = { customer: "customer", system: "system" } as const;

export type CancelOrigin = (typeof ORIGIN)[keyof typeof ORIGIN];

/**
 * What cancelling an order on the customer's word needs of the service that runs it. Which variant does that,
 * and how, is the variant's; the pieces it works with are here, because the system's own cancel — the
 * compensation after `pickup.failed` or a final `wash.faulted` — runs through the same ones.
 */
export interface CancelTarget {
  find(tenantId: string, orderId: string): Order | undefined;
  inTransaction<T>(fn: () => T): T;
  /** State, cancel step, and `order.cancelled`, inside the caller's transaction; returns the compensations promised. */
  cancelInPlace(order: Order, reason: string, origin: CancelOrigin, cause: Cause): string[];
  /** The refund compensation, which runs after the transaction commits and records its own outcome. */
  refundFor(order: Order, correlationId: string): Promise<void>;
}

/**
 * The order lifecycle of system-spec §9.3 over one repository and one outbox. Every state change and the event it
 * publishes commit in one transaction; billing calls happen after the commit and record their outcome as saga steps,
 * so a crash between the two leaves an order the reconciliation job can finish.
 */
export abstract class OrdersService implements OrdersPort, EventSink, CancelTarget {
  private reconciling = false;

  constructor(
    protected readonly repo: OrderRepository,
    protected readonly outbox: Outbox,
    protected readonly deps: ServiceDeps,
  ) {}

  async place(cmd: PlaceOrder, ctx: Ctx): Promise<Result<Order>> {
    if (!ownsHabitat(ctx.tenantId, cmd.habitatId)) return err(sudsnikError("FORBIDDEN", `habitat ${cmd.habitatId} is not operated by ${ctx.tenantId}`));
    if (this.repo.hasOpenOrderForPod(ctx.tenantId, cmd.podId)) return err(sudsnikError("CONFLICT", `pod ${cmd.podId} is already in an open order`));
    const now = this.deps.clock.now();
    const order: Order = {
      orderId: newId(),
      tenantId: ctx.tenantId,
      habitatId: cmd.habitatId,
      podId: cmd.podId,
      state: "placed",
      payment: "pending",
      placedAt: now,
      updatedAt: now,
      ...(cmd.notes === undefined ? {} : { notes: cmd.notes }),
    };
    this.repo.transaction(() => {
      this.repo.insert(order);
      this.repo.addStep({ orderId: order.orderId, step: "place", at: now, detail: { habitatId: order.habitatId, podId: order.podId } });
      this.enqueue("order.placed", order, { orderId: order.orderId, habitatId: order.habitatId, podId: order.podId, requestedAt: now }, { correlationId: ctx.correlationId });
    });
    if (this.deps.flags.isOn("billing.enabled")) await this.authorize(order, ctx.correlationId);
    return ok(order);
  }

  /** What `cancel` does is the variant's, over the pieces `CancelTarget` names. */
  abstract cancel(orderId: string, reason: string, ctx: Ctx): Promise<Result<Order>>;

  find(tenantId: string, orderId: string): Order | undefined {
    return this.repo.findById(tenantId, orderId);
  }

  inTransaction<T>(fn: () => T): T {
    return this.repo.transaction(fn);
  }

  refundFor(order: Order, correlationId: string): Promise<void> {
    return this.refund(order, correlationId);
  }

  async get(orderId: string, ctx: Ctx): Promise<Result<Order>> {
    const order = this.repo.findById(ctx.tenantId, orderId);
    return order ? ok(order) : err(notFound(orderId));
  }

  async list(filter: OrderFilter, ctx: Ctx): Promise<Result<Order[]>> {
    return ok(this.repo.list(ctx.tenantId, filter));
  }

  // The bus delivers each envelope once per consumer, so nothing below needs a dedupe of its own.
  async applyEvent(envelope: Envelope): Promise<Result<void>> {
    const topic = envelope.topic;
    if (!(topic in transitionTopics) && !(topic in paymentOf)) return err(sudsnikError("INVALID", `orders does not consume ${topic}`));
    const parsed = payloadSchemas[topic].safeParse(envelope.payload);
    if (!parsed.success) return err(sudsnikError("INVALID", `bad ${topic} payload: ${parsed.error.message}`));
    const payload = parsed.data as { orderId: string };
    const now = this.deps.clock.now();
    const log = this.deps.telemetry.logger.child({ topic, envelopeId: envelope.id, orderId: payload.orderId });

    const refundAfter = this.repo.transaction((): Order | undefined => {
      if (!this.claim({ envelope, orderId: payload.orderId, now })) return undefined;
      const order = this.repo.findAnyById(payload.orderId);
      if (!order) {
        log.warn("event_for_unknown_order");
        return undefined;
      }
      if (order.tenantId !== envelope.tenantId) {
        log.warn("event_tenant_mismatch", { orderTenant: order.tenantId, envelopeTenant: envelope.tenantId });
        return undefined;
      }
      const cause: Cause = { correlationId: envelope.correlationId, causationId: envelope.id };
      if (topic in paymentOf) {
        this.applyPayment(this.refresh(order), topic as keyof typeof paymentOf, envelope, now);
        return undefined;
      }
      const trigger = triggerOf(topic as ConsumedTopic, parsed.data);
      const next = nextState(order.state, trigger);
      if (!next) {
        log.info("event_ignored_in_state", { state: order.state, trigger });
        return undefined;
      }
      const current = this.refresh(order);
      current.updatedAt = now;
      applyFields(current, topic as ConsumedTopic, parsed.data);
      if (next === "cancelled") {
        const compensations = this.cancelInPlace(current, giveUpReason(topic as ConsumedTopic, parsed.data), ORIGIN.system, cause, { envelope, detail: parsed.data, now });
        return compensations.includes(COMPENSATION.refund) ? current : undefined;
      }
      current.state = next;
      if (next === "returned") {
        const returned = parsed.data as PayloadOf<"pod.returned">;
        current.returnedAt = returned.returnedAt;
        current.orbitsElapsed = (returned.returnedAt - current.placedAt) / ORBIT_MS;
        this.enqueue("order.returned", current, { orderId: current.orderId, podId: current.podId, habitatId: current.habitatId, returnedAt: returned.returnedAt, orbitsElapsed: current.orbitsElapsed }, cause);
      }
      this.repo.update(current);
      this.repo.addStep({ orderId: current.orderId, step: topic, at: now, detail: parsed.data, envelopeId: envelope.id });
      return undefined;
    });
    if (refundAfter) await this.refund(refundAfter, envelope.correlationId);
    return ok(undefined);
  }

  /** Retries every authorization and refund billing has not settled; runs once per orbit and at most once at a time. */
  async reconcile(): Promise<void> {
    if (this.reconciling || !this.deps.flags.isOn("billing.enabled")) return;
    this.reconciling = true;
    try {
      for (const order of this.repo.openWithPayment("pending")) {
        const latest = this.repo.latestStep(order.orderId, "authorize");
        if (latest === undefined || latest === "authorize:pending") await this.authorize(order, `reconcile-${order.orderId}`);
      }
      for (const order of this.repo.cancelledWithPayment("authorized")) {
        const latest = this.repo.latestStep(order.orderId, "refund");
        if (latest === undefined || latest === "refund:pending") await this.refund(order, `reconcile-${order.orderId}`);
      }
    } finally {
      this.reconciling = false;
    }
  }

  /** Records the envelope as consumed; false means it was applied before. */
  protected claim(event: EventClaim): boolean {
    return this.repo.claim(event.envelope.id, event.envelope.topic, event.now);
  }

  /** The order as this variant wants it before writing; the default trusts the read it already made. */
  protected refresh(order: Order): Order {
    return order;
  }

  cancelInPlace(order: Order, reason: string, origin: CancelOrigin, cause: Cause, viaEvent?: { envelope: Envelope; detail: unknown; now: number }): string[] {
    const now = viaEvent?.now ?? this.deps.clock.now();
    const compensations: string[] = [];
    if (order.payment === "authorized") compensations.push(COMPENSATION.refund);
    if (order.holdId !== undefined) compensations.push(COMPENSATION.releaseHold);
    order.state = "cancelled";
    order.cancelReason = reason;
    order.updatedAt = now;
    this.repo.update(order);
    if (viaEvent) this.repo.addStep({ orderId: order.orderId, step: viaEvent.envelope.topic, at: now, detail: viaEvent.detail, envelopeId: viaEvent.envelope.id });
    this.repo.addStep({ orderId: order.orderId, step: "cancel", at: now, detail: { reason, compensations } });
    this.enqueue("order.cancelled", order, { orderId: order.orderId, reason, origin, compensations }, cause);
    return compensations;
  }

  private applyPayment(order: Order, topic: keyof typeof paymentOf, envelope: Envelope, now: number): void {
    order.payment = paymentOf[topic];
    order.updatedAt = now;
    this.repo.update(order);
    this.repo.addStep({ orderId: order.orderId, step: topic, at: now, detail: envelope.payload, envelopeId: envelope.id });
  }

  private async authorize(order: Order, correlationId: string): Promise<void> {
    const ctx: Ctx = { tenantId: order.tenantId, correlationId, idempotencyKey: `authorize-${order.orderId}` };
    const billing = this.deps.clients.billing;
    const quote = await billing.quote(order.orderId, ctx);
    const charge = quote.ok ? await billing.authorize(order.orderId, quote.value.amount, ctx) : quote;
    const now = this.deps.clock.now();
    if (charge.ok) {
      order.payment = "authorized";
      order.updatedAt = now;
      this.repo.transaction(() => {
        this.repo.update(order);
        this.repo.addStep({ orderId: order.orderId, step: "authorize", at: now, detail: { chargeId: charge.value.chargeId, amount: charge.value.amount } });
      });
      return;
    }
    this.settleFailure(order, "authorize", charge.error, now);
  }

  private async refund(order: Order, correlationId: string): Promise<void> {
    const now = this.deps.clock.now();
    if (!this.deps.flags.isOn("billing.enabled")) {
      this.settleFailure(order, "refund", sudsnikError("UNAVAILABLE", "billing.enabled is off; refund left for reconciliation"), now);
      return;
    }
    const ctx: Ctx = { tenantId: order.tenantId, correlationId, idempotencyKey: `refund-${order.orderId}` };
    const refunded = await this.deps.clients.billing.refund(order.orderId, ctx);
    const settledAt = this.deps.clock.now();
    if (refunded.ok) {
      order.payment = "refunded";
      order.updatedAt = settledAt;
      this.repo.transaction(() => {
        this.repo.update(order);
        this.repo.addStep({ orderId: order.orderId, step: "refund", at: settledAt, detail: { chargeId: refunded.value.chargeId, amount: refunded.value.amount } });
      });
      return;
    }
    this.settleFailure(order, "refund", refunded.error, settledAt);
  }

  /** A retryable billing failure stays pending for reconciliation; any other is final. */
  private settleFailure(order: Order, kind: "authorize" | "refund", error: SudsnikError, now: number): void {
    const detail = { code: error.code, message: error.message };
    if (error.retryable) {
      this.repo.addStep({ orderId: order.orderId, step: `${kind}:pending`, at: now, detail });
      this.deps.telemetry.logger.warn(`${kind}_pending`, { orderId: order.orderId, ...detail });
      return;
    }
    if (kind === "authorize") {
      order.payment = "failed";
      order.updatedAt = now;
      this.repo.transaction(() => {
        this.repo.update(order);
        this.repo.addStep({ orderId: order.orderId, step: "authorize:failed", at: now, detail });
      });
    } else {
      this.repo.addStep({ orderId: order.orderId, step: "refund:failed", at: now, detail });
    }
    this.deps.telemetry.logger.error(`${kind}_failed`, { orderId: order.orderId, ...detail });
  }

  private enqueue<T extends "order.placed" | "order.cancelled" | "order.returned">(topic: T, order: Order, payload: PayloadOf<T>, cause: Cause): void {
    this.outbox.enqueue(makeEnvelope({ topic, tenantId: order.tenantId, occurredAt: this.deps.clock.now(), correlationId: cause.correlationId, ...(cause.causationId ? { causationId: cause.causationId } : {}), payload }));
  }
}

function ownsHabitat(tenantId: string, habitatId: string): boolean {
  try {
    return operatorOfHabitat(habitatId) === tenantId;
  } catch {
    return false;
  }
}

export function notFound(orderId: string): SudsnikError {
  return sudsnikError("NOT_FOUND", `no order ${orderId}`);
}

/** The cancel reason for an event the order does not survive: the fault, or the dispatch failure and its attempt count. */
function giveUpReason(topic: ConsumedTopic, payload: unknown): string {
  if (topic === "pickup.failed") {
    const failed = payload as PayloadOf<"pickup.failed">;
    return `pickup.failed:${failed.reason} after ${failed.attempts} attempts`;
  }
  return `wash.faulted:${(payload as PayloadOf<"wash.faulted">).faultCode}`;
}

function triggerOf(topic: ConsumedTopic, payload: unknown): Trigger {
  if (topic !== "wash.faulted") return topic;
  return (payload as PayloadOf<"wash.faulted">).final ? "wash.faulted:final" : "wash.faulted:retry";
}

function applyFields(order: Order, topic: ConsumedTopic, payload: unknown): void {
  switch (topic) {
    case "pickup.scheduled": {
      const p = payload as PayloadOf<"pickup.scheduled">;
      order.shuttleId = p.shuttleId;
      order.nodeId = p.nodeId;
      return;
    }
    case "return.scheduled":
    case "pod.collected":
    case "pod.returned":
      order.shuttleId = (payload as { shuttleId: string }).shuttleId;
      return;
    case "pod.delivered": {
      const p = payload as PayloadOf<"pod.delivered">;
      order.nodeId = p.nodeId;
      order.holdId = p.holdId;
      return;
    }
    case "hold.expired":
      delete order.holdId;
      return;
    default:
      return;
  }
}
