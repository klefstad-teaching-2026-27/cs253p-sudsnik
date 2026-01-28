import { z } from "zod";
import { IdSchema, SimMsSchema } from "../common.js";
export const PickupScheduled = z.object({ orderId: IdSchema, podId: IdSchema, habitatId: IdSchema, nodeId: IdSchema, shuttleId: IdSchema, windowStart: SimMsSchema, windowEnd: SimMsSchema });
export type PickupScheduled = z.infer<typeof PickupScheduled>;
