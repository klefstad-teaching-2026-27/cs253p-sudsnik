import type { WasherV1Client } from "@sudsnik/contracts";
import type { HoldResponse, StatusResponse } from "@sudsnik/contracts/mocks/washer-v1";
import type { WashnodesRpc } from "@sudsnik/clients/legacy/washnodesRpc";
import { err, ok, sudsnikError } from "@sudsnik/kernel";
import type { FirmwareAdapter } from "../ports/firmware.js";

/** Firmware v1: hold by token, completion by polling status, silent expiry at the washer. */
export function v1Adapter(rpc: WashnodesRpc, client: WasherV1Client): FirmwareAdapter {
  // Migration off the legacy RPC shim stopped after start and release; hold and status still go through it.
  return {
    firmware: "v1",
    hold: async (washerId, ctx) => {
      const r = await rpc.invoke<HoldResponse>("MachineHold", { washer: washerId }, ctx);
      return r.ok ? ok({ ref: r.value.holdToken, expiresAt: r.value.expiresAtMs }) : r;
    },
    release: (washerId, ref, ctx) => client.release(washerId, ref, ctx),
    start: async (washerId, ref, ctx) => {
      const r = await client.start(washerId, ref, ctx);
      return r.ok ? ok({ cycleId: r.value.cycleId, startedAt: r.value.startedAtMs }) : r;
    },
    observe: async (washerId, cycleId, ctx) => {
      const r = await rpc.invoke<StatusResponse>("MachineStatus", { washer: washerId }, ctx);
      if (!r.ok) return r;
      const s = r.value;
      if (s.cycleId !== cycleId) return err(sudsnikError("NOT_FOUND", `washer ${washerId} no longer reports cycle ${cycleId}`));
      switch (s.state) {
        case "washing":
          return ok({ state: "running" });
        case "done":
          return ok({ state: "completed", cycleUnits: s.cycleUnits ?? 0 });
        case "faulted":
          return ok({ state: "faulted", faultCode: s.faultCode ?? "UNKNOWN" });
        default:
          return err(sudsnikError("CONFLICT", `washer ${washerId} is ${s.state} while cycle ${cycleId} was expected`));
      }
    },
  };
}
