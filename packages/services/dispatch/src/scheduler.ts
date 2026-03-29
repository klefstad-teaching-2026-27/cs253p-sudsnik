import { MINUTE_MS, ORBIT_MS, type Ctx, type Envelope, type ServiceDeps } from "@sudsnik/contracts";
import type { Assignment } from "@sudsnik/contracts/services/dispatch";
import type { OrderPlaced } from "@sudsnik/contracts/events";
import type { Db } from "@sudsnik/infra-db";
import type { Outbox } from "@sudsnik/infra-queue";
import { err, ok, sudsnikError, type Result, type SudsnikError } from "@sudsnik/kernel";
import type { Gate } from "./gate.js";
import { acquireHold, releaseHold } from "./holds.js";
import type { Publisher } from "./publisher.js";
import { chooseShuttle } from "./shuttles.js";
import { toAssignment, type AssignmentRow, type OrderRow, type Store } from "./store.js";
import type { Strategy } from "./strategy.js";
import { LINK_WINDOW_MS } from "./windows.js";

/** How long a return waits when the node is out of contact: the status cache period, after which contact is asked again. */
export const CONTACT_RETRY_MS = 5 * MINUTE_MS;
/** A pickup or hold that fails this many times for a reason other than a busy node is marked failed and logged. */
export const MAX_ATTEMPTS = 30;
export const PICKUP_PUMP_EVERY_MS = MINUTE_MS;
/** A failed attempt is offered again a tick later. */
export const RETRY_MS = MINUTE_MS;
/**
 * A pod waiting for an idle washer is woken by the `hold.released`, `hold.expired`, or `wash.completed` that frees one
 * at its node; this sweep is only the backstop for a wake that never came. Polling for a washer is a cost defect.
 */
export const WASHER_SWEEP_MS = ORBIT_MS;

export interface Scheduler {
  onOrderPlaced(envelope: Envelope<OrderPlaced>): Promise<Result<void>>;
  schedulePickup(orderId: string, ctx: Ctx): Promise<Result<Assignment>>;
  scheduleReturn(orderId: string, ctx: Ctx, hint?: { nodeId?: string }): Promise<Result<Assignment>>;
  reassign(orderId: string, ctx: Ctx): Promise<Result<Assignment>>;
  cancel(orderId: string, reason: string, ctx: Ctx): Promise<Result<void>>;
  /** Puts the order back to waiting for a washer at its node; the next hold follows a wake or the sweep. */
  onHoldLost(orderId: string): Promise<void>;
  /** A washer at `nodeId` has freed: the oldest pod waiting there takes it. */
  onWasherFreed(nodeId: string): Promise<void>;
  /** Whether a pickup may be waiting to be scheduled; the per-minute timer reads the table only when it is. */
  queueHasWork(): boolean;
  /** Schedules queued pickups, oldest first, up to the in-flight limit. */
  pumpPickups(): Promise<void>;
  /** Holds a washer for every pod whose wait is due; the once-per-orbit backstop and the path a fresh arrival takes. */
  pumpArrivals(): Promise<void>;
  inflight(): number;
}

export interface SchedulerParts {
  deps: ServiceDeps;
  db: Db;
  store: Store;
  outbox: Outbox;
  publisher: Publisher;
  /** Open while the service may start work; a pass claims no further batch once it closes. */
  gate: Gate;
  strategy: Strategy;
  maxInflight: number;
}

/** No idle washer is a wait, not a failure; it never counts toward giving up. */
function nodeBusy(e: SudsnikError): boolean {
  return e.code === "QUOTA" || e.code === "CONFLICT";
}

function notPlaced(orderId: string) {
  return err(sudsnikError("CONFLICT", `order ${orderId} has not been placed with dispatch`));
}

export function createScheduler(parts: SchedulerParts): Scheduler {
  const { deps, db, store, outbox, publisher, gate, strategy } = parts;
  const log = deps.telemetry.logger;
  let inflight = 0;
  const passes: { pickups?: Promise<void>; arrivals?: Promise<void> } = {};
  const again = { pickups: false, arrivals: false };
  /** Whether an order may be waiting in the queue; the per-minute timer skips its read when none is. */
  let queuedPending = true;
  const queueHasWork = () => queuedPending;

  const pickupCtx = (order: OrderRow): Ctx => ({ tenantId: order.tenant_id, correlationId: order.correlation_id, idempotencyKey: `${order.order_id}:pickup:${order.attempts}` });
  const holdCtx = (order: OrderRow): Ctx => ({ tenantId: order.tenant_id, correlationId: order.correlation_id, idempotencyKey: `${order.order_id}:hold:${order.hold_attempts}` });

  async function planPickup(order: OrderRow, ctx: Ctx, replace?: AssignmentRow): Promise<Result<Assignment>> {
    if (strategy.beforePickup) {
      const before = await strategy.beforePickup(ctx);
      if (!before.ok) return before;
    }
    const nowMs = deps.clock.now();
    const window = await strategy.windows.next(order.habitat_id, nowMs, ctx);
    if (!window.ok) return window;
    const ranked = await strategy.nodes.rank(ctx);
    if (!ranked.ok) return ranked;
    const nodeId = ranked.value[0]!;

    const row = db.transaction(() => {
      if (replace) store.setAssignmentState(replace.id, "cancelled", nowMs);
      const shuttleId = chooseShuttle(store, { habitatId: order.habitat_id, nodeId, windowStart: window.value.startMs });
      const a = store.insertAssignment(
        { orderId: order.order_id, tenantId: order.tenant_id, leg: "pickup", shuttleId, nodeId, holdId: undefined, windowStart: window.value.startMs, windowEnd: window.value.endMs },
        nowMs,
      );
      store.setOrderState(order.order_id, "scheduled", nowMs);
      publisher.enqueue(
        "pickup.scheduled",
        order.tenant_id,
        { orderId: order.order_id, podId: order.pod_id, habitatId: order.habitat_id, nodeId, shuttleId, windowStart: a.window_start, windowEnd: a.window_end },
        { correlationId: ctx.correlationId, causationId: ctx.idempotencyKey ?? order.order_id },
      );
      return a;
    });
    await outbox.pump();
    return ok(toAssignment(row));
  }

  /** The pod is at the node: hold a washer there and only then tell the world it was delivered. */
  async function holdAtNode(order: OrderRow, ctx: Ctx): Promise<Result<Assignment>> {
    const pickup = store.currentAssignment(order.order_id, "pickup");
    if (!pickup) return err(sudsnikError("CONFLICT", `order ${order.order_id} has no pickup to hold for`));
    const nowMs = deps.clock.now();
    const hold = await acquireHold(deps.clients.washnodes, store, { orderId: order.order_id, tenantId: order.tenant_id, nodeId: pickup.node_id }, ctx, nowMs);
    if (!hold.ok) return hold;
    db.transaction(() => {
      store.setAssignmentHold(pickup.id, hold.value.hold_id, hold.value.node_id, nowMs);
      store.setOrderState(order.order_id, "held", nowMs);
      publisher.enqueue(
        "pod.delivered",
        order.tenant_id,
        { orderId: order.order_id, podId: order.pod_id, nodeId: hold.value.node_id, holdId: hold.value.hold_id, deliveredAt: order.delivered_at ?? nowMs },
        { correlationId: ctx.correlationId, causationId: ctx.idempotencyKey ?? order.order_id },
      );
    });
    await outbox.pump();
    return ok(toAssignment({ ...pickup, hold_id: hold.value.hold_id, node_id: hold.value.node_id }));
  }

  /**
   * Giving up is terminal, and an order nobody is told about is a dropped order: the state change and `pickup.failed`
   * land in one transaction so the mirror always hears. A pod waiting for a washer has not been given up on.
   */
  async function giveUp(order: OrderRow, reason: string, attempts: number, ctx: Ctx): Promise<void> {
    const nowMs = deps.clock.now();
    db.transaction(() => {
      store.setOrderState(order.order_id, "failed", nowMs);
      publisher.enqueue(
        "pickup.failed",
        order.tenant_id,
        { orderId: order.order_id, podId: order.pod_id, habitatId: order.habitat_id, reason, attempts },
        { correlationId: ctx.correlationId, causationId: ctx.idempotencyKey ?? order.order_id },
      );
    });
    await outbox.pump();
  }

  async function runQueued(order: OrderRow): Promise<void> {
    inflight++;
    const ctx = pickupCtx(order);
    try {
      const r = await planPickup(order, ctx);
      if (r.ok) return;
      const nowMs = deps.clock.now();
      if (order.attempts >= MAX_ATTEMPTS) {
        log.error("pickup_unschedulable", { orderId: order.order_id, attempts: order.attempts, error: r.error.message });
        await giveUp(order, r.error.message, order.attempts, ctx);
        return;
      }
      store.requeue(order.order_id, nowMs + RETRY_MS, nowMs);
      queuedPending = true;
      log.warn("pickup_deferred", { orderId: order.order_id, attempt: order.attempts, error: r.error.message });
    } finally {
      inflight--;
    }
  }

  async function runArrived(order: OrderRow): Promise<void> {
    const ctx = holdCtx(order);
    const r = await holdAtNode(order, ctx);
    if (r.ok) return;
    const nowMs = deps.clock.now();
    if (nodeBusy(r.error)) {
      store.waitForWasher(order.order_id, nowMs + WASHER_SWEEP_MS, nowMs);
      return;
    }
    const failures = order.hold_failures + 1;
    if (failures >= MAX_ATTEMPTS) {
      log.error("hold_unobtainable", { orderId: order.order_id, failures, error: r.error.message });
      await giveUp(order, r.error.message, failures, ctx);
      return;
    }
    store.deferHold(order.order_id, nowMs + RETRY_MS, nowMs);
    log.warn("hold_deferred", { orderId: order.order_id, failures, error: r.error.message });
  }

  /** A claim that returns fewer rows than it asked for has emptied the queue, so the pass stops without a second read. */
  async function drainPickups(): Promise<void> {
    queuedPending = false;
    for (let limit = parts.maxInflight - inflight; limit > 0 && gate.isOpen(); limit = parts.maxInflight - inflight) {
      const batch = store.claimQueued(limit, deps.clock.now());
      await Promise.all(batch.map(runQueued));
      if (batch.length < limit) return;
    }
  }

  // One arrival at a time: holds are taken in sequence, so two pods never contend for the same washer.
  async function drainArrivals(): Promise<void> {
    while (gate.isOpen()) {
      const batch = store.claimArrived(parts.maxInflight, deps.clock.now());
      await Promise.all(batch.map(runArrived));
      if (batch.length < parts.maxInflight) return;
    }
  }

  /** A call during a pass makes the pass run once more, so work queued mid-pass is not left until the next tick. */
  function coalesce(key: "pickups" | "arrivals", pass: () => Promise<void>): Promise<void> {
    const running = passes[key];
    if (running) {
      again[key] = true;
      return running;
    }
    const p = (async () => {
      do {
        again[key] = false;
        await pass();
      } while (again[key] && gate.isOpen());
    })();
    passes[key] = p;
    return p.finally(() => void (passes[key] = undefined));
  }

  const pumpPickups = () => coalesce("pickups", drainPickups);
  const pumpArrivals = () => coalesce("arrivals", drainArrivals);

  return {
    inflight: () => inflight,
    queueHasWork,
    pumpPickups,
    pumpArrivals,

    async onOrderPlaced(envelope) {
      const nowMs = deps.clock.now();
      const p = envelope.payload;
      const fresh = db.transaction(() => {
        if (!store.consumeEvent(envelope.id, envelope.topic, nowMs)) return false;
        store.insertOrder(
          { orderId: p.orderId, tenantId: envelope.tenantId, habitatId: p.habitatId, podId: p.podId, requestedAt: p.requestedAt, correlationId: envelope.correlationId },
          nowMs,
        );
        return true;
      });
      if (fresh) await pumpPickups();
      return ok(undefined);
    },

    async schedulePickup(orderId, ctx) {
      const order = store.order(orderId);
      if (!order) return notPlaced(orderId);
      const current = store.currentAssignment(orderId, "pickup");
      if (current) return ok(toAssignment(current));
      if (order.state === "scheduling") return err(sudsnikError("UNAVAILABLE", `order ${orderId} is being scheduled`));
      const nowMs = deps.clock.now();
      store.claimOrder(orderId, nowMs);
      inflight++;
      try {
        const r = await planPickup({ ...order, attempts: order.attempts + 1 }, ctx);
        if (!r.ok) {
          store.requeue(orderId, nowMs + RETRY_MS, nowMs);
          queuedPending = true;
        }
        return r;
      } finally {
        inflight--;
      }
    },

    async scheduleReturn(orderId, ctx, hint = {}) {
      const order = store.order(orderId);
      if (!order) return notPlaced(orderId);
      const current = store.currentAssignment(orderId, "return");
      if (current) return ok(toAssignment(current));
      const pickup = store.currentAssignment(orderId, "pickup");
      const nodeId = hint.nodeId ?? pickup?.node_id;
      if (!nodeId) return err(sudsnikError("CONFLICT", `order ${orderId} has no node to return from`));
      const contact = await strategy.inContact(nodeId, ctx);
      if (!contact.ok) return contact;
      const nowMs = deps.clock.now();
      const windowStart = contact.value ? nowMs : nowMs + CONTACT_RETRY_MS;
      const hold = store.activeHold(orderId);
      const row = db.transaction(() => {
        const shuttleId = chooseShuttle(store, { habitatId: order.habitat_id, nodeId, windowStart });
        const a = store.insertAssignment(
          { orderId, tenantId: order.tenant_id, leg: "return", shuttleId, nodeId, holdId: hold?.hold_id, windowStart, windowEnd: windowStart + LINK_WINDOW_MS },
          nowMs,
        );
        if (hold) store.setHoldState(hold.hold_id, "consumed", nowMs);
        publisher.enqueue(
          "return.scheduled",
          order.tenant_id,
          { orderId, podId: order.pod_id, habitatId: order.habitat_id, nodeId, shuttleId, windowStart: a.window_start, windowEnd: a.window_end },
          { correlationId: ctx.correlationId, causationId: ctx.idempotencyKey ?? orderId },
        );
        return a;
      });
      await outbox.pump();
      return ok(toAssignment(row));
    },

    async reassign(orderId, ctx) {
      const order = store.order(orderId);
      if (!order) return notPlaced(orderId);
      if (order.state === "cancelled" || order.state === "returned" || order.state === "failed") return err(sudsnikError("CONFLICT", `order ${orderId} is ${order.state}`));
      const nowMs = deps.clock.now();
      if (order.state === "arrived" || order.state === "waiting" || order.state === "holding" || order.state === "held") {
        // The pod is at the node: a fresh hold there, and pod.delivered again so washnodes starts on the new washer.
        const previous = store.activeHold(orderId);
        if (previous) store.setHoldState(previous.hold_id, "expired", nowMs);
        store.claimHolding(orderId, nowMs);
        const r = await holdAtNode({ ...order, hold_attempts: order.hold_attempts + 1 }, ctx);
        if (!r.ok) {
          if (nodeBusy(r.error)) store.waitForWasher(orderId, nowMs + WASHER_SWEEP_MS, nowMs);
          else store.deferHold(orderId, nowMs + RETRY_MS, nowMs);
        }
        return r;
      }
      const pickup = store.currentAssignment(orderId, "pickup");
      if (pickup && pickup.state !== "scheduled") return ok(toAssignment(pickup));
      store.claimOrder(orderId, nowMs);
      const r = await planPickup({ ...order, attempts: order.attempts + 1 }, ctx, pickup);
      if (!r.ok) {
        store.requeue(orderId, nowMs + RETRY_MS, nowMs);
        queuedPending = true;
      }
      return r;
    },

    async onHoldLost(orderId) {
      const order = store.order(orderId);
      if (!order || !order.wait_node || (order.state !== "held" && order.state !== "holding")) return;
      const nowMs = deps.clock.now();
      store.markArrived(orderId, order.wait_node, order.delivered_at ?? nowMs, nowMs);
      await pumpArrivals();
    },

    async onWasherFreed(nodeId) {
      // One washer, one pod: the sweep and the next free event carry the rest of the queue.
      const [next] = store.claimWaitingAt(nodeId, 1, deps.clock.now());
      if (next) await runArrived(next);
    },

    async cancel(orderId, reason, ctx) {
      const order = store.order(orderId);
      if (!order) return ok(undefined);
      const nowMs = deps.clock.now();
      const hold = store.activeHold(orderId);
      if (hold) {
        const released = await releaseHold(deps.clients.washnodes, store, hold.hold_id, reason, ctx, nowMs);
        if (!released.ok) log.warn("hold_release_failed", { orderId, holdId: hold.hold_id, error: released.error.message });
      }
      db.transaction(() => {
        store.cancelOpenAssignments(orderId, nowMs);
        store.setOrderState(orderId, "cancelled", nowMs);
      });
      return ok(undefined);
    },
  };
}
