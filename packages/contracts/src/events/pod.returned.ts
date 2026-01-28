import { z } from "zod";
import { IdSchema, SimMsSchema } from "../common.js";
export const PodReturned = z.object({ orderId: IdSchema, podId: IdSchema, shuttleId: IdSchema, returnedAt: SimMsSchema });
export type PodReturned = z.infer<typeof PodReturned>;
