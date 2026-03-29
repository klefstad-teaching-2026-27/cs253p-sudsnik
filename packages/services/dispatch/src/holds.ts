import { NODES, type Ctx, type NodeId, type WashnodesService } from "@sudsnik/contracts";
import type { NodeStatusResponse } from "@sudsnik/contracts/mocks/ephemeris";
import type { Hold } from "@sudsnik/contracts/services/washnodes";
import { err, ok, type Result } from "@sudsnik/kernel";
import type { HoldRow, Store } from "./store.js";

export const NODE_ROTATION = "node";

/** A washer id is its node letter followed by its index (contracts `washerId`), so it names the node it sits at. */
export function nodeOfWasher(washerId: string): string {
  return washerId.charAt(0);
}

/** Orders the wash nodes by preference for the next hold. */
export interface NodeRanker {
  rank(ctx: Ctx): Promise<Result<NodeId[]>>;
}

export type NodeStatusLookup = (nodeId: string, ctx: Ctx) => Promise<Result<NodeStatusResponse>>;

/** The node with the most free washers first, ties broken A, B, C; every node is asked. */
export function statusRanker(status: NodeStatusLookup): NodeRanker {
  return {
    async rank(ctx) {
      const free: Array<{ node: NodeId; free: number }> = [];
      for (const node of NODES) {
        const r = await status(node, ctx);
        if (!r.ok) return r;
        free.push({ node, free: r.value.washersFree });
      }
      free.sort((a, b) => b.free - a.free || NODES.indexOf(a.node) - NODES.indexOf(b.node));
      return ok(free.map((f) => f.node));
    },
  };
}

/** Round-robin over the nodes, persisted so a restart continues the rotation; the fallback while the breaker is open. */
export function roundRobinRanker(store: Store): NodeRanker {
  return {
    async rank() {
      const start = store.rotationIndex(NODE_ROTATION) % NODES.length;
      store.setRotationIndex(NODE_ROTATION, (start + 1) % NODES.length);
      return ok(NODES.map((_, i) => NODES[(start + i) % NODES.length]!));
    },
  };
}

/** `primary` unless it fails or `skip()` says not to ask; then `fallback`. */
export function rankerWithFallback(primary: NodeRanker, fallback: NodeRanker, skip: () => boolean): NodeRanker {
  return {
    async rank(ctx) {
      if (skip()) return fallback.rank(ctx);
      const r = await primary.rank(ctx);
      return r.ok ? r : fallback.rank(ctx);
    },
  };
}

function toRow(h: Hold, nowMs: number): HoldRow {
  return {
    hold_id: h.holdId,
    tenant_id: h.tenantId,
    order_id: h.orderId,
    node_id: h.nodeId,
    washer_id: h.washerId,
    state: h.state,
    acquired_at: h.acquiredAt,
    expires_at: h.expiresAt,
    updated_at: nowMs,
  };
}

/**
 * Asks `washnodes` for a hold at the node the pod is waiting at and records it. Acting on the HTTP result is the
 * rule; the `hold.acquired` event that follows only confirms the row.
 */
export async function acquireHold(washnodes: WashnodesService, store: Store, order: { orderId: string; tenantId: string; nodeId: string }, ctx: Ctx, nowMs: number): Promise<Result<HoldRow>> {
  const r = await washnodes.acquireHold(order.nodeId, order.orderId, ctx);
  if (!r.ok) return err(r.error);
  const row = toRow(r.value, nowMs);
  store.upsertHold(row, nowMs);
  return ok(row);
}

/** Releases a hold at `washnodes`; the local row is marked released either way, since the hold has no further use here. */
export async function releaseHold(washnodes: WashnodesService, store: Store, holdId: string, reason: string, ctx: Ctx, nowMs: number): Promise<Result<void>> {
  const r = await washnodes.releaseHold(holdId, reason, ctx);
  store.setHoldState(holdId, "released", nowMs);
  return r.ok ? ok(undefined) : err(r.error);
}
