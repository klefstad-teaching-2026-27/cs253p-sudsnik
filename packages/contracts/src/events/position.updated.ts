import { z } from "zod";
import { IdSchema, OrbitPhaseSchema, SimMsSchema } from "../common.js";
export const PositionUpdated = z.object({ shuttleId: IdSchema, orbitPhase: OrbitPhaseSchema, observedAt: SimMsSchema });
export type PositionUpdated = z.infer<typeof PositionUpdated>;
