import { z } from "zod";
import { IdSchema } from "../common.js";
export const HoldReleased = z.object({ holdId: IdSchema, washerId: IdSchema, orderId: IdSchema, reason: z.string() });
export type HoldReleased = z.infer<typeof HoldReleased>;
