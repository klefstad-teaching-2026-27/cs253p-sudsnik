import { z } from "zod";
import { IdSchema } from "../common.js";
export const RefundIssued = z.object({ orderId: IdSchema, refundId: IdSchema, amount: z.number().int(), currency: z.string().length(3) });
export type RefundIssued = z.infer<typeof RefundIssued>;
