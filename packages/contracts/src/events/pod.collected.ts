import { z } from "zod";
import { IdSchema, SimMsSchema } from "../common.js";
export const PodCollected = z.object({ orderId: IdSchema, podId: IdSchema, shuttleId: IdSchema, collectedAt: SimMsSchema });
export type PodCollected = z.infer<typeof PodCollected>;
