import { z } from "zod";
import { IdSchema, SimMsSchema } from "../common.js";
export const HoldAcquired = z.object({ holdId: IdSchema, washerId: IdSchema, nodeId: IdSchema, orderId: IdSchema, expiresAt: SimMsSchema });
export type HoldAcquired = z.infer<typeof HoldAcquired>;
