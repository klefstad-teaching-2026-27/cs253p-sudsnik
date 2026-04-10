import { z } from "zod";
import { IdSchema, IdempotencyHeaders } from "@sudsnik/contracts";
import { Report, SubmitReport, TriageResult } from "@sudsnik/contracts/services/support";
import { sendResult, type App } from "@sudsnik/infra-http";
import type { SupportCore } from "./service.js";

const ReportParams = z.object({ reportId: IdSchema });

/** The routes of contracts/services/support/routes.ts over the core. */
export function registerRoutes(app: App, service: SupportCore): void {
  app.post("/reports", { schema: { headers: IdempotencyHeaders, body: SubmitReport, response: { 201: Report } } }, async (req, reply) =>
    sendResult(reply, await service.report(req.body, req.ctx), 201),
  );
  app.get("/reports/:reportId", { schema: { params: ReportParams, response: { 200: Report } } }, async (req, reply) =>
    sendResult(reply, await service.get(req.params.reportId, req.ctx)),
  );
  app.post("/reports/:reportId/triage", { schema: { headers: IdempotencyHeaders, params: ReportParams, response: { 200: TriageResult } } }, async (req, reply) =>
    sendResult(reply, await service.triage(req.params.reportId, req.ctx)),
  );
  app.post("/reports/:reportId/escalate", { schema: { headers: IdempotencyHeaders, params: ReportParams, response: { 200: Report } } }, async (req, reply) =>
    sendResult(reply, await service.escalate(req.params.reportId, req.ctx)),
  );
}
