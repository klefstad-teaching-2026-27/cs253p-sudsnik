import { z } from "zod";
import { IdSchema, OrbitPhaseSchema, SimMsSchema } from "../../common.js";
import { RelayCallback } from "../../mocks/relay.js";

export const Position = z.object({ shuttleId: IdSchema, orbitPhase: OrbitPhaseSchema, observedAt: SimMsSchema, source: z.enum(["fresh", "cached"]) });
export type Position = z.infer<typeof Position>;
export const PodLocation = z.object({ podId: IdSchema, kind: z.enum(["habitat", "shuttle", "node"]), id: IdSchema, since: SimMsSchema });
export type PodLocation = z.infer<typeof PodLocation>;

export const routes = {
  position: { method: "GET", path: "/positions/:shuttleId", response: Position },
  positionCached: { method: "GET", path: "/positions/cached/:shuttleId", response: Position },
  positions: { method: "GET", path: "/positions", response: z.array(Position) },
  podLocation: { method: "GET", path: "/pods/:podId", response: PodLocation },
  relayCallback: { method: "POST", path: "/callbacks/relay", body: RelayCallback, response: z.object({ accepted: z.boolean(), duplicate: z.boolean() }) },
} as const;
