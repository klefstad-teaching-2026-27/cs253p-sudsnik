import { z } from "zod";
import { CommonEnvSchema } from "../../env.js";
export const DispatchEnvSchema = CommonEnvSchema.extend({
  SUDSNIK_DISPATCH_MAX_INFLIGHT: z.coerce.number().int().positive().default(64),
});
export type DispatchEnv = typeof DispatchEnvSchema._output;
