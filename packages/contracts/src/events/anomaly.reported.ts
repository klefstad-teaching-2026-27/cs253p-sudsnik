import { z } from "zod";
import { IdSchema } from "../common.js";
export const AnomalyReported = z.object({ reportId: IdSchema, podId: IdSchema, orderId: IdSchema, note: z.string() });
export type AnomalyReported = z.infer<typeof AnomalyReported>;
