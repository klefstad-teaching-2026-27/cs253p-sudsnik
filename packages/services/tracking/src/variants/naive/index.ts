import { SHUTTLES, type ServiceDeps } from "@sudsnik/contracts";
import type { Position } from "@sudsnik/contracts/services/tracking";
import { mapResult, ok, type Result } from "@sudsnik/kernel";
import { buildApp, fresh, ingest, podLocation } from "../../app.js";

/** Every read, the cached route included, fetches `ephemeris`; the store and cache are never read. */
export const createApp = (deps: ServiceDeps) =>
  buildApp(deps, "naive", (parts) => {
    const position = async (shuttleId: string, ctx: Parameters<typeof deps.clients.ephemeris.position>[1]): Promise<Result<Position>> =>
      mapResult(await deps.clients.ephemeris.position(shuttleId, ctx), fresh);
    return {
      position,
      positionCached: position,
      async positions(ctx) {
        const out: Position[] = [];
        for (const s of SHUTTLES) {
          const r = await position(s, ctx);
          if (!r.ok) return r;
          out.push(r.value);
        }
        return ok(out);
      },
      podLocation: podLocation(parts),
      relay: (body, ctx) => ingest(parts, body, ctx),
    };
  });
