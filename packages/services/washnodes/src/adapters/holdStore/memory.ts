import { err, newId, ok, sudsnikError } from "@sudsnik/kernel";
import { firmwareRefOf, guardTransition, type StoredHold } from "../../domain/hold.js";
import type { HoldStore } from "@sudsnik/contracts/services/washnodes";
import type { WasherRepo } from "../../ports/washerRepo.js";

/** The starter's store: holds in a Map, gone on restart, and no check that the washer is still idle. */
export function memoryHoldStore(washers: WasherRepo): HoldStore {
  const holds = new Map<string, StoredHold>();
  return {
    acquire: async (input) => {
      const ref = firmwareRefOf(input.firmwareRef, `hold for order ${input.orderId}`);
      if (!ref.ok) return ref;
      const hold: StoredHold = {
        holdId: newId(),
        tenantId: input.tenantId,
        nodeId: input.nodeId,
        washerId: input.washerId,
        orderId: input.orderId,
        state: "held",
        acquiredAt: input.nowMs,
        expiresAt: input.nowMs + input.ttlMs,
        version: 0,
        firmwareRef: ref.value,
      };
      washers.markHeld(input.washerId, hold.holdId);
      holds.set(hold.holdId, hold);
      return ok(hold);
    },
    release: async (holdId, expectedVersion, _reason, _nowMs) => {
      const guarded = guardTransition(holds.get(holdId), holdId, expectedVersion);
      if (!guarded.ok) return guarded;
      const next: StoredHold = { ...guarded.value, state: "released", version: guarded.value.version + 1 };
      holds.set(holdId, next);
      washers.free(next.washerId, holdId);
      return ok(next);
    },
    consume: async (holdId, expectedVersion, _nowMs) => {
      const guarded = guardTransition(holds.get(holdId), holdId, expectedVersion);
      if (!guarded.ok) return guarded;
      const next: StoredHold = { ...guarded.value, state: "consumed", version: guarded.value.version + 1 };
      holds.set(holdId, next);
      washers.startWashing(next.washerId);
      return ok(next);
    },
    expire: async (nowMs) => {
      const expired: StoredHold[] = [];
      for (const hold of holds.values()) {
        if (hold.state !== "held" || hold.expiresAt > nowMs) continue;
        const next: StoredHold = { ...hold, state: "expired", version: hold.version + 1 };
        holds.set(hold.holdId, next);
        washers.free(hold.washerId, hold.holdId);
        expired.push(next);
      }
      return ok(expired);
    },
    get: async (holdId) => {
      const hold = holds.get(holdId);
      return hold ? ok(hold) : err(sudsnikError("NOT_FOUND", `no hold ${holdId}`));
    },
  };
}
