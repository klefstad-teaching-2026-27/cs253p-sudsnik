import type { Assignment } from "@sudsnik/contracts/services/dispatch";
import type { Db } from "@sudsnik/infra-db";
import { newId } from "@sudsnik/kernel";

/**
 * queued → scheduling → scheduled (pickup published) → arrived (pod at the node, a hold is due) → holding → held
 * (pod.delivered published) → returned. `waiting` is arrived with no idle washer at the node: woken when one frees.
 */
export type OrderState = "queued" | "scheduling" | "scheduled" | "arrived" | "waiting" | "holding" | "held" | "failed" | "returned" | "cancelled";
export type HoldState = "held" | "consumed" | "released" | "expired";
export type Leg = Assignment["leg"];
export type AssignmentState = Assignment["state"];

export interface OrderRow {
  order_id: string;
  tenant_id: string;
  habitat_id: string;
  pod_id: string;
  requested_at: number;
  correlation_id: string;
  state: OrderState;
  /** How far the pod has come: 0 at the habitat, 1 collected, 2 delivered, 3 returned. */
  progress: number;
  attempts: number;
  /** Every hold request, so each carries a fresh idempotency key; `hold_failures` counts only the ones that were not a busy node. */
  hold_attempts: number;
  hold_failures: number;
  /** A requeued or waiting order is not claimed again before this time. */
  retry_at: number;
  /** From the `delivered` callback; what `pod.delivered` reports once a hold is held. */
  delivered_at: number | null;
  /** The node the pod is at, once it has arrived; the wake on a freed washer is keyed by it. */
  wait_node: string | null;
  updated_at: number;
}

export interface AssignmentRow {
  id: string;
  order_id: string;
  tenant_id: string;
  leg: Leg;
  shuttle_id: string;
  node_id: string;
  hold_id: string | null;
  window_start: number;
  window_end: number;
  state: AssignmentState;
  created_at: number;
  updated_at: number;
}

export interface HoldRow {
  hold_id: string;
  tenant_id: string;
  order_id: string;
  node_id: string;
  washer_id: string;
  state: HoldState;
  acquired_at: number;
  expires_at: number;
  updated_at: number;
}

export interface TripRow {
  shuttle_id: string;
  window_start: number;
  habitat_id: string;
  node_id: string;
  pods: number;
}

export interface NewAssignment {
  orderId: string;
  tenantId: string;
  leg: Leg;
  shuttleId: string;
  nodeId: string;
  holdId: string | undefined;
  windowStart: number;
  windowEnd: number;
}

export function toAssignment(row: AssignmentRow): Assignment {
  return {
    orderId: row.order_id,
    tenantId: row.tenant_id,
    leg: row.leg,
    shuttleId: row.shuttle_id,
    nodeId: row.node_id,
    ...(row.hold_id === null ? {} : { holdId: row.hold_id }),
    windowStart: row.window_start,
    windowEnd: row.window_end,
    state: row.state,
  };
}

/** Every statement the service runs; callers compose them inside `db.transaction` where several must land together. */
export function createStore(db: Db) {
  /** Runs a select of orders due for a hold attempt and moves each to `holding` under one transaction. */
  function claim(sql: string, params: unknown[], limit: number, nowMs: number): OrderRow[] {
    if (limit <= 0) return [];
    return db.transaction(() => {
      const rows = db.read<OrderRow>(sql, ...params);
      for (const r of rows) db.write("update orders set state = 'holding', hold_attempts = hold_attempts + 1, updated_at = ? where order_id = ?", nowMs, r.order_id);
      return rows.map((r) => ({ ...r, state: "holding" as const, hold_attempts: r.hold_attempts + 1 }));
    });
  }

  return {
    /** True when this call consumed the event; false when an earlier delivery already had. */
    consumeEvent(envelopeId: string, topic: string, nowMs: number): boolean {
      return db.write("insert or ignore into consumed_events (envelope_id, topic, consumed_at) values (?, ?, ?)", envelopeId, topic, nowMs).changes === 1;
    },
    /** Peeks at the dedupe table without marking: for a handler that must not consume until its fallible work succeeds. */
    wasConsumed(envelopeId: string, topic: string): boolean {
      return db.readOne("select 1 from consumed_events where envelope_id = ? and topic = ?", envelopeId, topic) !== undefined;
    },

    order(orderId: string): OrderRow | undefined {
      return db.readOne<OrderRow>("select * from orders where order_id = ?", orderId);
    },
    insertOrder(o: { orderId: string; tenantId: string; habitatId: string; podId: string; requestedAt: number; correlationId: string }, nowMs: number): boolean {
      return (
        db.write(
          "insert or ignore into orders (order_id, tenant_id, habitat_id, pod_id, requested_at, correlation_id, state, updated_at) values (?, ?, ?, ?, ?, ?, 'queued', ?)",
          o.orderId,
          o.tenantId,
          o.habitatId,
          o.podId,
          o.requestedAt,
          o.correlationId,
          nowMs,
        ).changes === 1
      );
    },
    setOrderState(orderId: string, state: OrderState, nowMs: number): void {
      db.write("update orders set state = ?, updated_at = ? where order_id = ?", state, nowMs, orderId);
    },
    /** Moves the oldest due queued orders to `scheduling` and returns them in placement (rowid) order, each with its attempt counted. */
    claimQueued(limit: number, nowMs: number): OrderRow[] {
      if (limit <= 0) return [];
      return db.transaction(() => {
        const rows = db.read<OrderRow>("select * from orders where state = 'queued' and retry_at <= ? order by rowid limit ?", nowMs, limit);
        for (const r of rows) db.write("update orders set state = 'scheduling', attempts = attempts + 1, updated_at = ? where order_id = ?", nowMs, r.order_id);
        return rows.map((r) => ({ ...r, state: "scheduling" as const, attempts: r.attempts + 1 }));
      });
    },
    /** Claims one specific order for scheduling; false when it is not waiting in the queue. */
    claimOrder(orderId: string, nowMs: number): boolean {
      return db.write("update orders set state = 'scheduling', attempts = attempts + 1, updated_at = ? where order_id = ? and state = 'queued'", nowMs, orderId).changes === 1;
    },
    requeue(orderId: string, retryAt: number, nowMs: number): void {
      db.write("update orders set state = 'queued', retry_at = ?, updated_at = ? where order_id = ? and state = 'scheduling'", retryAt, nowMs, orderId);
    },
    /** The pod is at the node and needs a washer: the hold pump takes it from here. */
    markArrived(orderId: string, nodeId: string, deliveredAt: number, nowMs: number): void {
      db.write("update orders set state = 'arrived', wait_node = ?, delivered_at = ?, retry_at = 0, updated_at = ? where order_id = ?", nodeId, deliveredAt, nowMs, orderId);
    },
    /** Moves the oldest due arrived and waiting orders to `holding`, in placement order; the once-per-orbit sweep. */
    claimArrived(limit: number, nowMs: number): OrderRow[] {
      return claim("select * from orders where state in ('arrived', 'waiting') and retry_at <= ? order by rowid limit ?", [nowMs, limit], limit, nowMs);
    },
    /** Moves the oldest pods waiting at one node to `holding`, whatever their sweep time; a washer there has freed. */
    claimWaitingAt(nodeId: string, limit: number, nowMs: number): OrderRow[] {
      return claim("select * from orders where state = 'waiting' and wait_node = ? order by rowid limit ?", [nodeId, limit], limit, nowMs);
    },
    claimHolding(orderId: string, nowMs: number): void {
      db.write("update orders set state = 'holding', hold_attempts = hold_attempts + 1, updated_at = ? where order_id = ?", nowMs, orderId);
    },
    /** No idle washer at the node: the pod waits there until one frees, with `sweepAt` as the backstop. */
    waitForWasher(orderId: string, sweepAt: number, nowMs: number): void {
      db.write("update orders set state = 'waiting', retry_at = ?, updated_at = ? where order_id = ? and state = 'holding'", sweepAt, nowMs, orderId);
    },
    /** The acquisition failed for a reason other than a busy node: try again at `retryAt`, counting the failure. */
    deferHold(orderId: string, retryAt: number, nowMs: number): void {
      db.write(
        "update orders set state = 'arrived', retry_at = ?, hold_failures = hold_failures + 1, updated_at = ? where order_id = ? and state = 'holding'",
        retryAt,
        nowMs,
        orderId,
      );
    },
    setProgress(orderId: string, progress: number, nowMs: number): void {
      db.write("update orders set progress = ?, updated_at = ? where order_id = ?", progress, nowMs, orderId);
    },

    assignments(orderId: string): AssignmentRow[] {
      return db.read<AssignmentRow>("select * from assignments where order_id = ? order by created_at, rowid", orderId);
    },
    /** The newest assignment of a leg that was not cancelled. */
    currentAssignment(orderId: string, leg: Leg): AssignmentRow | undefined {
      return db.readOne<AssignmentRow>(
        "select * from assignments where order_id = ? and leg = ? and state <> 'cancelled' order by created_at desc, rowid desc limit 1",
        orderId,
        leg,
      );
    },
    insertAssignment(a: NewAssignment, nowMs: number): AssignmentRow {
      const row: AssignmentRow = {
        id: newId(),
        order_id: a.orderId,
        tenant_id: a.tenantId,
        leg: a.leg,
        shuttle_id: a.shuttleId,
        node_id: a.nodeId,
        hold_id: a.holdId ?? null,
        window_start: a.windowStart,
        window_end: a.windowEnd,
        state: "scheduled",
        created_at: nowMs,
        updated_at: nowMs,
      };
      db.write(
        "insert into assignments (id, order_id, tenant_id, leg, shuttle_id, node_id, hold_id, window_start, window_end, state, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        row.id,
        row.order_id,
        row.tenant_id,
        row.leg,
        row.shuttle_id,
        row.node_id,
        row.hold_id,
        row.window_start,
        row.window_end,
        row.state,
        row.created_at,
        row.updated_at,
      );
      return row;
    },
    setAssignmentState(id: string, state: AssignmentState, nowMs: number): void {
      db.write("update assignments set state = ?, updated_at = ? where id = ?", state, nowMs, id);
    },
    setAssignmentHold(id: string, holdId: string, nodeId: string, nowMs: number): void {
      db.write("update assignments set hold_id = ?, node_id = ?, updated_at = ? where id = ?", holdId, nodeId, nowMs, id);
    },
    cancelOpenAssignments(orderId: string, nowMs: number): void {
      db.write("update assignments set state = 'cancelled', updated_at = ? where order_id = ? and state in ('scheduled', 'underway')", nowMs, orderId);
    },

    hold(holdId: string): HoldRow | undefined {
      return db.readOne<HoldRow>("select * from holds where hold_id = ?", holdId);
    },
    /** The order's newest hold still held, if any. */
    activeHold(orderId: string): HoldRow | undefined {
      return db.readOne<HoldRow>("select * from holds where order_id = ? and state = 'held' order by acquired_at desc, rowid desc limit 1", orderId);
    },
    upsertHold(h: Omit<HoldRow, "updated_at">, nowMs: number): void {
      db.lazy(() =>
        db.write(
          "insert into holds (hold_id, tenant_id, order_id, node_id, washer_id, state, acquired_at, expires_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict (hold_id) do update set state = excluded.state, expires_at = excluded.expires_at, updated_at = excluded.updated_at",
          h.hold_id,
          h.tenant_id,
          h.order_id,
          h.node_id,
          h.washer_id,
          h.state,
          h.acquired_at,
          h.expires_at,
          nowMs,
        ),
      );
    },
    setHoldState(holdId: string, state: HoldState, nowMs: number): boolean {
      return db.write("update holds set state = ?, updated_at = ? where hold_id = ?", state, nowMs, holdId).changes === 1;
    },

    trip(shuttleId: string, windowStart: number): TripRow | undefined {
      return db.readOne<TripRow>("select * from trips where shuttle_id = ? and window_start = ?", shuttleId, windowStart);
    },
    addToTrip(t: Omit<TripRow, "pods">): void {
      db.lazy(() =>
        db.write(
          "insert into trips (shuttle_id, window_start, habitat_id, node_id, pods) values (?, ?, ?, ?, 1) on conflict (shuttle_id, window_start) do update set pods = pods + 1",
          t.shuttle_id,
          t.window_start,
          t.habitat_id,
          t.node_id,
        ),
      );
    },

    rotationIndex(name: string): number {
      return db.readOne<{ next_index: number }>("select next_index from rotation where name = ?", name)?.next_index ?? 0;
    },
    setRotationIndex(name: string, next: number): void {
      db.lazy(() => db.write("insert into rotation (name, next_index) values (?, ?) on conflict (name) do update set next_index = excluded.next_index", name, next));
    },

    recordPosition(shuttleId: string, orbitPhase: number, observedAt: number): void {
      db.lazy(() =>
        db.write(
          "insert into shuttle_positions (shuttle_id, orbit_phase, observed_at) values (?, ?, ?) on conflict (shuttle_id) do update set orbit_phase = excluded.orbit_phase, observed_at = excluded.observed_at",
          shuttleId,
          orbitPhase,
          observedAt,
        ),
      );
    },

    /** True when this call recorded the callback; false when its id was already seen. */
    recordCallback(c: { id: string; tenantId: string; kind: string; orderId: string | undefined }, nowMs: number): boolean {
      return db.write("insert or ignore into relay_callbacks (id, tenant_id, kind, order_id, received_at) values (?, ?, ?, ?, ?)", c.id, c.tenantId, c.kind, c.orderId ?? null, nowMs).changes === 1;
    },
    rejectCallback(r: { callbackId: string | undefined; tenantId: string; reason: string; body: unknown }, nowMs: number): void {
      db.write(
        "insert into rejected_callbacks (callback_id, tenant_id, reason, body, received_at) values (?, ?, ?, ?, ?)",
        r.callbackId ?? null,
        r.tenantId,
        r.reason,
        JSON.stringify(r.body ?? null),
        nowMs,
      );
    },
    rejectedCallbacks(): Array<{ callback_id: string | null; tenant_id: string; reason: string; body: string; received_at: number }> {
      return db.read("select callback_id, tenant_id, reason, body, received_at from rejected_callbacks order by seq");
    },
  };
}

export type Store = ReturnType<typeof createStore>;
