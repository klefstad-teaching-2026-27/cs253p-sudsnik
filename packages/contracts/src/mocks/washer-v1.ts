import { z } from "zod";
import { IdSchema, SimMsSchema } from "../common.js";

export const HoldRequest = z.object({ washer: IdSchema });
export const HoldResponse = z.object({ holdToken: z.string(), washer: IdSchema, expiresAtMs: SimMsSchema });
export const StatusResponse = z.object({
  washer: IdSchema,
  state: z.enum(["idle", "held", "washing", "done", "faulted"]),
  cycleId: IdSchema.optional(),
  cycleUnits: z.number().int().nonnegative().optional(),
  faultCode: z.string().optional(),
});
export const StartRequest = z.object({ washer: IdSchema, holdToken: z.string() });
export const StartResponse = z.object({ cycleId: IdSchema, startedAtMs: SimMsSchema });
export const ReleaseRequest = z.object({ washer: IdSchema, holdToken: z.string() });
export type StatusResponse = z.infer<typeof StatusResponse>;
export type HoldResponse = z.infer<typeof HoldResponse>;
export type StartResponse = z.infer<typeof StartResponse>;
