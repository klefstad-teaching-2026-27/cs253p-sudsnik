import { z } from "zod";
import { IdSchema, SimMsSchema } from "../../common.js";
import { Action, Severity } from "../../mocks/oracle.js";

export const SubmitReport = z.object({ orderId: IdSchema, podId: IdSchema, note: z.string().min(1).max(2000) });
export type SubmitReport = z.infer<typeof SubmitReport>;
export const TriageResult = z.object({ category: z.string().min(1), severity: Severity, action: Action, tokens: z.number().int().nonnegative(), guarded: z.boolean() });
export type TriageResult = z.infer<typeof TriageResult>;
export const Report = SubmitReport.extend({
  reportId: IdSchema,
  tenantId: IdSchema,
  receivedAt: SimMsSchema,
  state: z.enum(["received", "triaged", "escalated"]),
  triage: TriageResult.optional(),
});
export type Report = z.infer<typeof Report>;

export const routes = {
  report: { method: "POST", path: "/reports", body: SubmitReport, response: Report, idempotent: true },
  get: { method: "GET", path: "/reports/:reportId", response: Report },
  triage: { method: "POST", path: "/reports/:reportId/triage", response: TriageResult, idempotent: true },
  escalate: { method: "POST", path: "/reports/:reportId/escalate", response: Report, idempotent: true },
} as const;
