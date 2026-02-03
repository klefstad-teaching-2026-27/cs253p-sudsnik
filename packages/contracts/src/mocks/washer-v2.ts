import { z } from "zod";
import { IdSchema, SimMsSchema } from "../common.js";

export const CreateHoldRequest = z.object({ washerId: IdSchema });
export const HoldResponse = z.object({ holdId: IdSchema, washerId: IdSchema, expiresAtMs: SimMsSchema });
export const StartCycleRequest = z.object({ holdId: IdSchema, callbackUrl: z.string().url() });
export const CycleState = z.enum(["running", "completed", "faulted"]);
export const CycleResponse = z.object({
  cycleId: IdSchema,
  washerId: IdSchema,
  state: CycleState,
  startedAtMs: SimMsSchema,
  endsAtMs: SimMsSchema,
  cycleUnits: z.number().int().nonnegative().optional(),
  faultCode: z.string().optional(),
});
/** Delivered at POST <callbackUrl>/washer through relay. */
export const WasherCallback = z.object({
  id: IdSchema,
  cycleId: IdSchema,
  washerId: IdSchema,
  state: z.enum(["completed", "faulted"]),
  cycleUnits: z.number().int().nonnegative().optional(),
  faultCode: z.string().optional(),
  atMs: SimMsSchema,
});
export type WasherCallback = z.infer<typeof WasherCallback>;
export type CycleResponse = z.infer<typeof CycleResponse>;
export type HoldResponse = z.infer<typeof HoldResponse>;
