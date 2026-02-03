import { z } from "zod";
import { IdSchema, OrbitPhaseSchema, SimMsSchema } from "../common.js";

export const Window = z.object({ startMs: SimMsSchema, endMs: SimMsSchema });
export const WindowsResponse = z.object({ habitatId: IdSchema, windows: z.array(Window), computedAtMs: SimMsSchema });
export const PositionResponse = z.object({ shuttleId: IdSchema, orbitPhase: OrbitPhaseSchema, atMs: SimMsSchema });
export const NodeStatusResponse = z.object({
  nodeId: IdSchema,
  inContact: z.boolean(),
  washersFree: z.number().int().nonnegative(),
  cachedAtMs: SimMsSchema,
});
export type Window = z.infer<typeof Window>;
export type WindowsResponse = z.infer<typeof WindowsResponse>;
export type PositionResponse = z.infer<typeof PositionResponse>;
export type NodeStatusResponse = z.infer<typeof NodeStatusResponse>;
