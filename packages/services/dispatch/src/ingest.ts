import type { Ctx, ServiceDeps } from "@sudsnik/contracts";
import type { RelayCallback } from "@sudsnik/contracts/mocks/relay";
import type { RelayIngest } from "@sudsnik/contracts/services/dispatch";
import type { Db } from "@sudsnik/infra-db";
import type { Outbox } from "@sudsnik/infra-queue";
import { err, ok, sudsnikError, type Result } from "@sudsnik/kernel";
import type { Publisher } from "./publisher.js";
import type { AssignmentRow, OrderRow, Store } from "./store.js";

export type PodCallback = Extract<RelayCallback, { kind: "collected" | "delivered" | "returned" }>;

/** What one callback records about itself, which is how an ingest that expects repeats recognises one. */
export interface CallbackEntry {
  id: string;
  tenantId: string;
  kind: RelayCallback["kind"];
  orderId: string | undefined;
}

/** The steps of the journey a callback settles, or nothing where the order has already passed them. */
export type StepRange = { from: number; to: number } | undefined;

/**
 * How much a variant trusts the relay. The relay is documented as ordered exactly-once and is neither,
 * so what an ingest does about a corrupt body, a repeat, and a callback that arrives before the one it follows is
 * the whole of the difference between variants, and each supplies its own.
 */
export interface IngestTrust {
  /** Whether the body arrived intact; one that did not is refused and recorded. */
  verify(body: RelayCallback): boolean;
  /** Whether this callback is new. */
  fresh(entry: CallbackEntry, nowMs: number): boolean;
  /** Which steps to apply, given how far the order had got; an error refuses the callback outright. */
  range(body: PodCallback, progress: number): Result<StepRange>;
}

export type IngestTrustFactory = (store: Store) => IngestTrust;

export type Ingest = RelayIngest<RelayCallback>;

/** The pod's journey in callback order; `orders.progress` records the last step applied. */
export const STEPS = ["collected", "delivered", "returned"] as const;
type Step = (typeof STEPS)[number];
export const stepIndex = (kind: Step) => STEPS.indexOf(kind) + 1;

export interface IngestParts {
  deps: ServiceDeps;
  db: Db;
  store: Store;
  outbox: Outbox;
  publisher: Publisher;
  trust: IngestTrustFactory;
  /** Runs after a callback that brought a pod to its node commits; the scheduler holds a washer and publishes `pod.delivered`. */
  onArrived(): Promise<void>;
}

export function createIngest(parts: IngestParts): Ingest {
  const { deps, db, store, outbox, publisher, onArrived } = parts;
  const trust = parts.trust(store);

  function reject(body: RelayCallback, ctx: Ctx, code: "INVALID" | "NOT_FOUND", reason: string, nowMs: number): Result<never> {
    store.rejectCallback({ callbackId: body.id, tenantId: ctx.tenantId, reason, body }, nowMs);
    return err(sudsnikError(code, reason));
  }

  /** Where the pod's journey stands before a callback is applied: the pickup leg, and the node a `delivered` step needs. */
  interface Journey {
    pickup: AssignmentRow | undefined;
    nodeId: string | undefined;
  }

  function journeyOf(order: OrderRow, body: PodCallback): Journey {
    const pickup = store.currentAssignment(order.order_id, "pickup");
    return { pickup, nodeId: pickup?.node_id ?? (body.kind === "delivered" ? body.nodeId : undefined) };
  }

  /**
   * One step of the journey, from the callback that reports it or from a later one that implies it. It cannot
   * fail: the caller has already refused a callback it could not apply, so no step commits beside a failed one.
   */
  function applyStep(order: OrderRow, step: Step, body: PodCallback, ctx: Ctx, nowMs: number, at: Journey): void {
    const cause = { correlationId: ctx.correlationId, causationId: body.id };
    const { pickup } = at;
    switch (step) {
      case "collected": {
        if (pickup?.state === "scheduled") store.setAssignmentState(pickup.id, "underway", nowMs);
        publisher.enqueue("pod.collected", order.tenant_id, { orderId: order.order_id, podId: order.pod_id, shuttleId: body.shuttleId, collectedAt: body.atMs }, cause);
        return;
      }
      case "delivered": {
        // pod.delivered follows only once a washer at the node is held; the pump takes it from `arrived`.
        if (pickup && pickup.state !== "done") store.setAssignmentState(pickup.id, "done", nowMs);
        store.markArrived(order.order_id, at.nodeId!, body.atMs, nowMs);
        return;
      }
      case "returned": {
        const ret = store.currentAssignment(order.order_id, "return");
        if (ret && ret.state !== "done") store.setAssignmentState(ret.id, "done", nowMs);
        store.setOrderState(order.order_id, "returned", nowMs);
        publisher.enqueue("pod.returned", order.tenant_id, { orderId: order.order_id, podId: order.pod_id, shuttleId: body.shuttleId, returnedAt: body.atMs }, cause);
        return;
      }
    }
  }

  /** Counters an alert rule can read: every callback, and what the relay did to it on the way. */
  const count = (name: string) => deps.telemetry.counter(`dispatch.${name}`).add(1);
  /** The latest event time any callback carried; one stamped earlier than it was delivered out of order. */
  let latestAtMs = 0;

  function applyPod(body: PodCallback, ctx: Ctx, nowMs: number): Result<{ duplicate: boolean; arrived: boolean }> {
    return db.transaction((): Result<{ duplicate: boolean; arrived: boolean }> => {
      if (!trust.fresh({ id: body.id, tenantId: ctx.tenantId, kind: body.kind, orderId: body.orderId }, nowMs)) return ok({ duplicate: true, arrived: false });
      const order = store.order(body.orderId);
      if (!order) return reject(body, ctx, "NOT_FOUND", `order ${body.orderId} is unknown to dispatch`, nowMs);
      const steps = trust.range(body, order.progress);
      if (!steps.ok) return steps;
      if (steps.value === undefined) return ok({ duplicate: true, arrived: false });
      const { from, to: target } = steps.value;
      const delivers = from <= stepIndex("delivered") && target >= stepIndex("delivered");
      const at = journeyOf(order, body);
      // Refused before any step runs: a transaction that returns an error still commits, so a step applied
      // beside a failure would publish its event and leave `progress` behind to publish it again.
      if (delivers && at.nodeId === undefined) return err(sudsnikError("CONFLICT", `order ${order.order_id} has no node to be delivered to`));
      for (let i = from; i <= target; i++) applyStep(order, STEPS[i - 1]!, body, ctx, nowMs, at);
      if (target > order.progress) store.setProgress(order.order_id, target, nowMs);
      return ok({ duplicate: false, arrived: delivers });
    });
  }

  return {
    async accept(body, ctx) {
      const nowMs = deps.clock.now();
      count("callbacks");
      if (body.atMs < latestAtMs) count("callback_out_of_order");
      latestAtMs = Math.max(latestAtMs, body.atMs);
      if (!trust.verify(body)) {
        count("callback_rejected");
        return reject(body, ctx, "INVALID", "checksum does not verify", nowMs);
      }
      if (body.kind === "position") {
        // Shuttle positions are tracking's callback; one that reaches dispatch is acknowledged and not acted on.
        const duplicate = !trust.fresh({ id: body.id, tenantId: ctx.tenantId, kind: body.kind, orderId: undefined }, nowMs);
        if (duplicate) count("callback_duplicates");
        return ok({ duplicate });
      }
      const r = applyPod(body, ctx, nowMs);
      if (r.ok && r.value.duplicate) count("callback_duplicates");
      if (!r.ok || r.value.duplicate) return r;
      await outbox.pump();
      // Only a callback that brought the pod to its node needs a hold; the others have nothing for the pump to do.
      if (r.value.arrived) await onArrived();
      return r;
    },
  };
}
