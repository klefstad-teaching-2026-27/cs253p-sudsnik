import { z } from "zod";
import { IdSchema, SimMsSchema } from "../common.js";
export const OrderReturned = z.object({ orderId: IdSchema, podId: IdSchema, habitatId: IdSchema, returnedAt: SimMsSchema, orbitsElapsed: z.number().nonnegative() });
export type OrderReturned = z.infer<typeof OrderReturned>;
