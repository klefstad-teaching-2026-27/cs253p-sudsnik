import { z } from "zod";
import { IdSchema } from "../common.js";
export const HoldExpired = z.object({ holdId: IdSchema, washerId: IdSchema, orderId: IdSchema });
export type HoldExpired = z.infer<typeof HoldExpired>;
