import { z } from "zod";
import { IdSchema } from "../common.js";
export const ChargeFailed = z.object({ orderId: IdSchema, reason: z.string() });
export type ChargeFailed = z.infer<typeof ChargeFailed>;
