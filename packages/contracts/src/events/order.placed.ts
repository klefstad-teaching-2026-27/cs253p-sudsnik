import { z } from "zod";
import { IdSchema, SimMsSchema } from "../common.js";
export const OrderPlaced = z.object({ orderId: IdSchema, habitatId: IdSchema, podId: IdSchema, requestedAt: SimMsSchema });
export type OrderPlaced = z.infer<typeof OrderPlaced>;
