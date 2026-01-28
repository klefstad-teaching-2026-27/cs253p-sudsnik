import { z } from "zod";
import { IdSchema, SimMsSchema } from "../common.js";
export const ReturnScheduled = z.object({ orderId: IdSchema, podId: IdSchema, habitatId: IdSchema, nodeId: IdSchema, shuttleId: IdSchema, windowStart: SimMsSchema, windowEnd: SimMsSchema });
export type ReturnScheduled = z.infer<typeof ReturnScheduled>;
