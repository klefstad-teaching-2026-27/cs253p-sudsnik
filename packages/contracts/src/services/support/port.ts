import type { Result } from "@sudsnik/kernel";
import type { Ctx } from "../../common.js";
import type { Report, SubmitReport, TriageResult } from "./routes.js";

export interface SupportService {
  report(report: SubmitReport, ctx: Ctx): Promise<Result<Report>>;
  triage(reportId: string, ctx: Ctx): Promise<Result<TriageResult>>;
  escalate(reportId: string, ctx: Ctx): Promise<Result<Report>>;
}

export interface TriageWorkflow {
  classify(input: { reportId: string; note: string; tenantId: string }, ctx: Ctx): Promise<Result<TriageResult>>;
}
