import { z } from "zod";
import { IdSchema, SimMsSchema } from "../common.js";
export const WashStarted = z.object({ orderId: IdSchema, washerId: IdSchema, startedAt: SimMsSchema });
export type WashStarted = z.infer<typeof WashStarted>;
