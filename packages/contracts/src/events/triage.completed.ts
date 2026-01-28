import { z } from "zod";
import { IdSchema } from "../common.js";
import { Action, Severity } from "../mocks/oracle.js";
export const TriageCompleted = z.object({ reportId: IdSchema, orderId: IdSchema, podId: IdSchema, category: z.string(), severity: Severity, action: Action, tokens: z.number().int().nonnegative() });
export type TriageCompleted = z.infer<typeof TriageCompleted>;
