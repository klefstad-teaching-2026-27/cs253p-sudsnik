import type { Ctx, Logger } from "@sudsnik/contracts";
import type { WasherCallback } from "@sudsnik/contracts/mocks/washer-v2";
import type { HoldStore } from "@sudsnik/contracts/services/washnodes";
import type { Clock } from "@sudsnik/kernel";
import { isFinalAttempt, type CycleOutcome, type CycleRecord } from "../domain/cycle.js";
import { FAULT_COOLDOWN_MS } from "../domain/washer.js";
import type { CycleRepo } from "../ports/cycleRepo.js";
import type { Dedupe } from "../ports/dedupe.js";
import type { FirmwareAdapters } from "../ports/firmware.js";
import type { NodeRepo } from "../ports/nodeRepo.js";
import type { Publisher } from "../ports/publisher.js";
import type { WasherRepo } from "../ports/washerRepo.js";
import type { WashnodesUseCases } from "./service.js";

/** wash.faulted names the pod; a cycle started through the HTTP port, which names no pod, reports this. */
export const UNKNOWN_POD = "unknown";

export interface CycleDeps {
  clock: Clock;
  logger: Logger;
  service: WashnodesUseCases;
  washers: WasherRepo;
  holds: HoldStore;
  cycles: CycleRepo;
  nodes: NodeRepo;
  firmware: FirmwareAdapters;
  publish: Publisher;
  callbacks: Dedupe;
  /** How long a running v2 cycle may go unheard of before the reconciliation sweep reads it back. */
  reconcileStaleAfterMs: number;
}

export interface CallbackReceipt {
  accepted: boolean;
  duplicate: boolean;
}

/** Everything that happens to a cycle after it starts: outcomes, retries, hold expiry, and the sweeps that drive them. */
export interface CycleFlow {
  callback(body: WasherCallback): CallbackReceipt;
  /** Expires holds, returns faulted washers to service, and retries faulted cycles; runs every minute. */
  sweep(): Promise<void>;
  /** Reads every running v1 cycle from the firmware; runs every V1_POLL_MS. */
  pollV1(): Promise<void>;
  /** Reads back every running v2 cycle older than the deps' stale threshold. */
  reconcileV2(): Promise<void>;
}

export function createCycleFlow(d: CycleDeps): CycleFlow {
  const now = () => d.clock.now();
  const ctxOf = (c: CycleRecord): Ctx => ({ tenantId: c.tenantId, correlationId: c.correlationId });

  /** Applies a settled outcome once; a second report of the same cycle changes nothing. */
  async function settle(cycle: CycleRecord, outcome: Exclude<CycleOutcome, { state: "running" }>, atMs: number): Promise<void> {
    if (!d.cycles.finish(cycle.cycleId, outcome, atMs)) return;
    const origin = { tenantId: cycle.tenantId, correlationId: cycle.correlationId };
    if (outcome.state === "completed") {
      d.washers.free(cycle.washerId, cycle.holdId);
      d.publish.emit("wash.completed", origin, { orderId: cycle.orderId, washerId: cycle.washerId, completedAt: atMs, cycleUnits: outcome.cycleUnits });
      return;
    }
    d.washers.fault(cycle.washerId, now());
    const final = isFinalAttempt(cycle.attempt);
    d.publish.emit("wash.faulted", origin, { orderId: cycle.orderId, podId: cycle.podId ?? UNKNOWN_POD, washerId: cycle.washerId, faultCode: outcome.faultCode, attempt: cycle.attempt, final });
    if (final) return;
    d.cycles.setRetryPending(cycle.cycleId, true);
    await retry(cycle);
  }

  /** A retry is a fresh hold on another idle washer at the node; with none idle it waits for the next sweep. */
  async function retry(faulted: CycleRecord): Promise<void> {
    const ctx = ctxOf(faulted);
    const hold = await d.service.acquireHold(faulted.nodeId, faulted.orderId, ctx);
    if (!hold.ok) {
      if (hold.error.code !== "QUOTA") d.logger.warn("retry_hold_failed", { orderId: faulted.orderId, error: hold.error.message });
      return;
    }
    const started = await d.service.startWash(hold.value.holdId, faulted.podId, ctx);
    if (!started.ok) {
      d.logger.warn("retry_start_failed", { orderId: faulted.orderId, holdId: hold.value.holdId, error: started.error.message });
      await d.service.releaseHold(hold.value.holdId, "retry start failed", ctx);
      return;
    }
    d.cycles.setRetryPending(faulted.cycleId, false);
  }

  async function observe(cycle: CycleRecord): Promise<void> {
    const r = await d.firmware[cycle.firmware].observe(cycle.washerId, cycle.cycleId, ctxOf(cycle));
    if (!r.ok) {
      if (r.error.code === "TIMEOUT" || r.error.code === "UNAVAILABLE") d.nodes.setContact(cycle.nodeId, false, now());
      else d.logger.warn("observe_failed", { cycleId: cycle.cycleId, error: r.error.message });
      return;
    }
    d.nodes.setContact(cycle.nodeId, true, now());
    if (r.value.state !== "running") await settle(cycle, r.value, now());
  }

  return {
    callback(body) {
      if (d.callbacks.seen(body.id)) return { accepted: true, duplicate: true };
      d.callbacks.mark(body.id, now());
      const cycle = d.cycles.get(body.cycleId);
      if (!cycle) {
        d.logger.warn("callback_unknown_cycle", { cycleId: body.cycleId, washerId: body.washerId });
        return { accepted: false, duplicate: false };
      }
      d.nodes.setContact(cycle.nodeId, true, now());
      const outcome: Exclude<CycleOutcome, { state: "running" }> =
        body.state === "completed" ? { state: "completed", cycleUnits: body.cycleUnits ?? 0 } : { state: "faulted", faultCode: body.faultCode ?? "UNKNOWN" };
      // A faulted cycle's retry calls the firmware; the receipt must not wait on it.
      void settle(cycle, outcome, body.atMs).catch((e: unknown) => d.logger.error("settle_failed", { cycleId: cycle.cycleId, error: String(e) }));
      return { accepted: true, duplicate: false };
    },
    async sweep() {
      const nowMs = now();
      const expired = await d.holds.expire(nowMs);
      if (expired.ok) {
        for (const h of expired.value) d.publish.emit("hold.expired", { tenantId: h.tenantId }, { holdId: h.holdId, washerId: h.washerId, orderId: h.orderId });
      }
      d.washers.restoreFaulted(nowMs - FAULT_COOLDOWN_MS);
      for (const c of d.cycles.pendingRetries()) await retry(c);
    },
    async pollV1() {
      for (const c of d.cycles.running("v1", now())) await observe(c);
    },
    async reconcileV2() {
      for (const c of d.cycles.running("v2", now() - d.reconcileStaleAfterMs)) await observe(c);
    },
  };
}
