import { z } from "zod";
import { IdSchema } from "../common.js";
export const ChargeCaptured = z.object({ orderId: IdSchema, chargeId: IdSchema, amount: z.number().int(), currency: z.string().length(3) });
export type ChargeCaptured = z.infer<typeof ChargeCaptured>;
