import { z } from "zod";
import { CommonEnvSchema } from "../../env.js";
export const SupportEnvSchema = CommonEnvSchema.extend({ SUDSNIK_SUPPORT_TOKEN_BUDGET_PER_ORBIT: z.coerce.number().int().positive().default(20_000) });
export type SupportEnv = typeof SupportEnvSchema._output;
