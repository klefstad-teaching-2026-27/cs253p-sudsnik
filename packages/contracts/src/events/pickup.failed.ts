import { z } from "zod";
import { IdSchema } from "../common.js";
/** Dispatch has given up scheduling this order. Publishing it is what keeps an abandoned order visible. */
export const PickupFailed = z.object({ orderId: IdSchema, podId: IdSchema, habitatId: IdSchema, reason: z.string(), attempts: z.number().int().positive() });
export type PickupFailed = z.infer<typeof PickupFailed>;
