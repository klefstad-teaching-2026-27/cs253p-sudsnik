import { z } from "zod";
import { IdSchema } from "../common.js";
/** `origin` separates a cancellation someone asked for from a compensation the system ran after giving up. */
export const OrderCancelled = z.object({ orderId: IdSchema, reason: z.string(), origin: z.enum(["customer", "system"]), compensations: z.array(z.string()) });
export type OrderCancelled = z.infer<typeof OrderCancelled>;
