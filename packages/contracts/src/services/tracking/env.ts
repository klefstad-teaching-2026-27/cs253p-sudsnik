import { z } from "zod";
import { CommonEnvSchema } from "../../env.js";
export const TrackingEnvSchema = CommonEnvSchema.extend({ SUDSNIK_TRACKING_CACHE_TTL_MS: z.coerce.number().int().positive().default(300_000) });
export type TrackingEnv = typeof TrackingEnvSchema._output;
