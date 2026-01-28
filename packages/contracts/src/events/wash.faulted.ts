import { z } from "zod";
import { IdSchema } from "../common.js";
export const WashFaulted = z.object({ orderId: IdSchema, podId: IdSchema, washerId: IdSchema, faultCode: z.string(), attempt: z.number().int().positive(), final: z.boolean() });
export type WashFaulted = z.infer<typeof WashFaulted>;
