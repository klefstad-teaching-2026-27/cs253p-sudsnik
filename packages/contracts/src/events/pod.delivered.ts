import { z } from "zod";
import { IdSchema, SimMsSchema } from "../common.js";
export const PodDelivered = z.object({ orderId: IdSchema, podId: IdSchema, nodeId: IdSchema, holdId: IdSchema, deliveredAt: SimMsSchema });
export type PodDelivered = z.infer<typeof PodDelivered>;
