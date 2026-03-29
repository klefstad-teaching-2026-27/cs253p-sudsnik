import { fileURLToPath } from "node:url";
import { SHUTTLES, type ServiceDeps } from "@sudsnik/contracts";
import { ok } from "@sudsnik/kernel";
import { buildApp } from "../../app.js";
import { statusRanker } from "../../holds.js";
import type { Store } from "../../store.js";
import type { Strategy } from "../../strategy.js";
import { liveWindows } from "../../windows.js";
import { naiveTrust } from "./trust.js";

export const variant = "naive";
export const handlersDir = fileURLToPath(new URL("../../handlers/", import.meta.url));

/**
 * The starter (system-spec §9.4): on every order `/windows` once, `/position` for every shuttle, and `/status` for
 * every node, ten `ephemeris` calls with no cache and no breaker; a failure is the order's failure until the queue retries.
 */
export function naiveStrategy(deps: ServiceDeps, store: Store): Strategy {
  const ephemeris = deps.clients.ephemeris;
  return {
    windows: liveWindows(ephemeris),
    nodes: statusRanker((nodeId, ctx) => ephemeris.status(nodeId, ctx)),
    async beforePickup(ctx) {
      for (const shuttleId of SHUTTLES) {
        const r = await ephemeris.position(shuttleId, ctx);
        if (!r.ok) return r;
        store.recordPosition(shuttleId, r.value.orbitPhase, r.value.atMs);
      }
      return ok(undefined);
    },
    async inContact(nodeId, ctx) {
      const r = await ephemeris.status(nodeId, ctx);
      return r.ok ? ok(r.value.inContact) : r;
    },
    ingest: naiveTrust,
  };
}

export function createApp(deps: ServiceDeps) {
  return buildApp(deps, variant, naiveStrategy);
}
