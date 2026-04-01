import type { WasherV2Client } from "@sudsnik/contracts";
import type { CycleResponse } from "@sudsnik/contracts/mocks/washer-v2";
import { ok } from "@sudsnik/kernel";
import type { CycleOutcome } from "../domain/cycle.js";
import type { FirmwareAdapter } from "../ports/firmware.js";

export function outcomeOf(c: CycleResponse): CycleOutcome {
  if (c.state === "running") return { state: "running" };
  if (c.state === "completed") return { state: "completed", cycleUnits: c.cycleUnits ?? 0 };
  return { state: "faulted", faultCode: c.faultCode ?? "UNKNOWN" };
}

/** Firmware v2: explicit holds, cycles reported by callback and readable back for reconciliation. */
export function v2Adapter(client: WasherV2Client, callbackUrl: string): FirmwareAdapter {
  return {
    firmware: "v2",
    hold: async (washerId, ctx) => {
      const r = await client.createHold(washerId, ctx);
      return r.ok ? ok({ ref: r.value.holdId, expiresAt: r.value.expiresAtMs }) : r;
    },
    release: async (_washerId, ref, ctx) => {
      const r = await client.deleteHold(ref, ctx);
      return !r.ok && r.error.code === "NOT_FOUND" ? ok(undefined) : r;
    },
    start: async (_washerId, ref, ctx) => {
      const r = await client.startCycle(ref, callbackUrl, ctx);
      return r.ok ? ok({ cycleId: r.value.cycleId, startedAt: r.value.startedAtMs }) : r;
    },
    observe: async (_washerId, cycleId, ctx) => {
      const r = await client.cycle(cycleId, ctx);
      return r.ok ? ok(outcomeOf(r.value)) : r;
    },
  };
}
