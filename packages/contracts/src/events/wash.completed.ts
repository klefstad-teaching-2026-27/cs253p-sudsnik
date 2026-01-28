import { z } from "zod";
import { IdSchema, SimMsSchema } from "../common.js";
export const WashCompleted = z.object({ orderId: IdSchema, washerId: IdSchema, completedAt: SimMsSchema, cycleUnits: z.number().int().nonnegative() });
export type WashCompleted = z.infer<typeof WashCompleted>;
