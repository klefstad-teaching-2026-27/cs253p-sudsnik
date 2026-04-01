import { HOLD_TTL_MS, type Ctx, type Logger } from "@sudsnik/contracts";
import type { Hold, HoldStore, NodeStatus, WashnodesService } from "@sudsnik/contracts/services/washnodes";
import { err, ok, sudsnikError, type Clock, type Result } from "@sudsnik/kernel";
import { firmwareRefOf, isPastExpiry } from "../domain/hold.js";
import { isNodeId, washerView } from "../domain/washer.js";
import type { CycleRepo } from "../ports/cycleRepo.js";
import type { FirmwareAdapters } from "../ports/firmware.js";
import type { NodeRepo } from "../ports/nodeRepo.js";
import type { Publisher } from "../ports/publisher.js";
import type { WasherRepo } from "../ports/washerRepo.js";

export interface ServiceDeps {
  clock: Clock;
  logger: Logger;
  washers: WasherRepo;
  holds: HoldStore;
  cycles: CycleRepo;
  nodes: NodeRepo;
  firmware: FirmwareAdapters;
  publish: Publisher;
}

/** The port plus the entry pod.delivered uses: the same start, with the pod named. */
export interface WashnodesUseCases extends WashnodesService {
  startWash(holdId: string, podId: string | undefined, ctx: Ctx): Promise<Result<CycleStart>>;
}

export interface CycleStart {
  cycleId: string;
  washerId: string;
  startedAt: number;
}

/** A hold is visible to its own tenant only; any other tenant sees NOT_FOUND, never CONFLICT. */
function ownHold(r: Result<Hold>, ctx: Ctx, holdId: string): Result<Hold> {
  if (r.ok && r.value.tenantId !== ctx.tenantId) return err(sudsnikError("NOT_FOUND", `no hold ${holdId}`));
  return r;
}

export function createService(d: ServiceDeps): WashnodesUseCases {
  const now = () => d.clock.now();

  async function acquireHold(nodeId: string, orderId: string, ctx: Ctx): Promise<Result<Hold>> {
    if (!isNodeId(nodeId)) return err(sudsnikError("NOT_FOUND", `no node ${nodeId}`));
    const washer = d.washers.pickIdle(nodeId);
    if (!washer) return err(sudsnikError("QUOTA", `no idle washer at node ${nodeId}`));
    const adapter = d.firmware[washer.firmware];
    const fw = await adapter.hold(washer.washerId, ctx);
    if (!fw.ok) return fw;
    const nowMs = now();
    const ttlMs = Math.max(0, Math.min(HOLD_TTL_MS, fw.value.expiresAt - nowMs));
    const stored = await d.holds.acquire({ nodeId, washerId: washer.washerId, orderId, tenantId: ctx.tenantId, nowMs, ttlMs, firmwareRef: fw.value.ref });
    if (!stored.ok) {
      await adapter.release(washer.washerId, fw.value.ref, ctx);
      return stored;
    }
    const hold = stored.value;
    d.publish.emit("hold.acquired", { tenantId: ctx.tenantId, correlationId: ctx.correlationId }, { holdId: hold.holdId, washerId: hold.washerId, nodeId, orderId, expiresAt: hold.expiresAt });
    return ok(hold);
  }

  async function releaseHold(holdId: string, reason: string, ctx: Ctx): Promise<Result<Hold>> {
    const found = ownHold(await d.holds.get(holdId), ctx, holdId);
    if (!found.ok) return found;
    const hold = found.value;
    if (hold.state === "released") return ok(hold);
    const released = await d.holds.release(holdId, hold.version, reason, now());
    if (!released.ok) return released;
    // The firmware's hold lapses on its own at the end of the orbit, so a refusal here is logged, not returned.
    const ref = firmwareRefOf(hold.firmwareRef, `hold ${holdId}`);
    const fw = ref.ok ? await d.firmware[d.washers.get(hold.washerId)?.firmware ?? "v2"].release(hold.washerId, ref.value, ctx) : ref;
    if (!fw.ok) d.logger.warn("firmware_release_failed", { holdId, washerId: hold.washerId, error: fw.error.message });
    d.publish.emit("hold.released", { tenantId: ctx.tenantId, correlationId: ctx.correlationId }, { holdId, washerId: hold.washerId, orderId: hold.orderId, reason });
    return ok(released.value);
  }

  async function startWash(holdId: string, podId: string | undefined, ctx: Ctx): Promise<Result<CycleStart>> {
    const found = ownHold(await d.holds.get(holdId), ctx, holdId);
    if (!found.ok) return found;
    const hold = found.value;
    if (hold.state === "consumed") {
      const existing = d.cycles.byHold(holdId);
      return existing ? ok({ cycleId: existing.cycleId, washerId: existing.washerId, startedAt: existing.startedAt }) : err(sudsnikError("CONFLICT", `hold ${holdId} is consumed`));
    }
    if (hold.state !== "held") return err(sudsnikError("CONFLICT", `hold ${holdId} is ${hold.state}`));
    if (isPastExpiry(hold, now())) return err(sudsnikError("CONFLICT", `hold ${holdId} expired at ${hold.expiresAt}`));
    const washer = d.washers.get(hold.washerId);
    if (!washer) return err(sudsnikError("INTERNAL", `hold ${holdId} names unknown washer ${hold.washerId}`));
    const ref = firmwareRefOf(hold.firmwareRef, `hold ${holdId}`);
    if (!ref.ok) return ref;
    const started = await d.firmware[washer.firmware].start(washer.washerId, ref.value, ctx);
    if (!started.ok) return started;
    // The firmware is running a cycle from here on, whatever happened to the hold while the call was in flight.
    // A hold the expiry sweep took in that window has already freed the washer, so the cycle is recorded and the
    // washer marked busy anyway: leaving it idle would let a second order hold a washer that is physically washing.
    const consumed = await d.holds.consume(holdId, hold.version, now());
    if (!consumed.ok) {
      d.washers.startWashing(washer.washerId);
      d.logger.error("cycle_started_without_hold", { holdId, cycleId: started.value.cycleId, washerId: washer.washerId, error: consumed.error.message });
    }
    const attempt = d.cycles.attemptsFor(hold.orderId) + 1;
    d.cycles.insert({
      cycleId: started.value.cycleId,
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      holdId,
      orderId: hold.orderId,
      ...(podId ? { podId } : {}),
      nodeId: hold.nodeId,
      washerId: washer.washerId,
      firmware: washer.firmware,
      attempt,
      state: "running",
      startedAt: started.value.startedAt,
      retryPending: false,
    });
    d.publish.emit("wash.started", { tenantId: ctx.tenantId, correlationId: ctx.correlationId }, { orderId: hold.orderId, washerId: washer.washerId, startedAt: started.value.startedAt });
    return ok({ cycleId: started.value.cycleId, washerId: washer.washerId, startedAt: started.value.startedAt });
  }

  async function status(nodeId: string, _ctx: Ctx): Promise<Result<NodeStatus>> {
    if (!isNodeId(nodeId)) return err(sudsnikError("NOT_FOUND", `no node ${nodeId}`));
    return ok({ nodeId, inContact: d.nodes.inContact(nodeId), washers: d.washers.listByNode(nodeId).map(washerView) });
  }

  return { acquireHold, releaseHold, startCycle: (holdId, ctx) => startWash(holdId, undefined, ctx), startWash, status };
}
