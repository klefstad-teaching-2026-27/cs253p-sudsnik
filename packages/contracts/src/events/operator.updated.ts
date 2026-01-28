import { z } from "zod";
import { CURRENCIES } from "../canon.js";
import { IdSchema } from "../common.js";
export const OperatorUpdated = z.object({ operatorId: IdSchema, pricingTier: z.enum(["standard", "priority"]), region: z.enum(["us", "eu", "apac"]), currency: z.enum(CURRENCIES) });
export type OperatorUpdated = z.infer<typeof OperatorUpdated>;
