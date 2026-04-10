import { makeEnvelope, type Ctx, type ServiceDeps } from "@sudsnik/contracts";
import type { Report, SubmitReport, SupportService, TriageResult, TriageWorkflow } from "@sudsnik/contracts/services/support";
import type { AnomalyReported, TriageCompleted } from "@sudsnik/contracts/events";
import type { Db } from "@sudsnik/infra-db";
import type { Outbox } from "@sudsnik/infra-queue";
import { err, newId, ok, sudsnikError, type Result } from "@sudsnik/kernel";
import type { Store } from "./store.js";

/** The port plus what the routes and handlers need beyond it. */
export interface SupportCore extends SupportService {
  get(reportId: string, ctx: Ctx): Promise<Result<Report>>;
  /** Stores a report and queues `anomaly.reported`; runs inside the caller's transaction so a handler can dedupe in the same one. */
  open(input: SubmitReport, ctx: Ctx): Report;
  /** Publishes what `open` queued and triages: the second half of `report()`. */
  complete(report: Report, ctx: Ctx): Promise<Report>;
}

export interface ServiceOptions {
  deps: ServiceDeps;
  db: Db;
  store: Store;
  outbox: Outbox;
  workflow: TriageWorkflow;
}

export function createSupportService(opts: ServiceOptions): SupportCore {
  const { deps, db, store, outbox, workflow } = opts;
  const { logger } = deps.telemetry;
  const notFound = (reportId: string) => err(sudsnikError("NOT_FOUND", `no report ${reportId}`));

  const core: SupportCore = {
    open(input, ctx) {
      const now = deps.clock.now();
      const reportId = newId();
      store.insertReport({ reportId, tenantId: ctx.tenantId, ...input, receivedAt: now, state: "received", triageId: null });
      const payload: AnomalyReported = { reportId, podId: input.podId, orderId: input.orderId, note: input.note };
      outbox.enqueue(makeEnvelope({ topic: "anomaly.reported", tenantId: ctx.tenantId, occurredAt: now, correlationId: ctx.correlationId, payload }));
      return { reportId, tenantId: ctx.tenantId, ...input, receivedAt: now, state: "received" };
    },

    async complete(report, ctx) {
      await outbox.pump();
      const triaged = await core.triage(report.reportId, ctx);
      if (!triaged.ok) logger.warn("triage_deferred", { reportId: report.reportId, error: triaged.error.message });
      return store.report(ctx.tenantId, report.reportId) ?? report;
    },

    async report(input, ctx) {
      const opened = db.transaction(() => core.open(input, ctx));
      return ok(await core.complete(opened, ctx));
    },

    async get(reportId, ctx) {
      const report = store.report(ctx.tenantId, reportId);
      return report ? ok(report) : notFound(reportId);
    },

    async triage(reportId, ctx) {
      const report = store.report(ctx.tenantId, reportId);
      if (!report) return notFound(reportId);
      const classified = await workflow.classify({ reportId, note: report.note, tenantId: ctx.tenantId }, ctx);
      if (!classified.ok) return classified;
      const result: TriageResult = classified.value;
      const now = deps.clock.now();
      db.transaction(() => {
        store.insertTriage({ triageId: newId(), reportId, tenantId: ctx.tenantId, ...result, triagedAt: now }, report.state === "escalated" ? "escalated" : "triaged");
        const payload: TriageCompleted = { reportId, orderId: report.orderId, podId: report.podId, category: result.category, severity: result.severity, action: result.action, tokens: result.tokens };
        outbox.enqueue(makeEnvelope({ topic: "triage.completed", tenantId: ctx.tenantId, occurredAt: now, correlationId: ctx.correlationId, payload }));
      });
      await outbox.pump();
      return ok(result);
    },

    async escalate(reportId, ctx) {
      const report = store.report(ctx.tenantId, reportId);
      if (!report) return notFound(reportId);
      if (report.state !== "escalated") store.setState(reportId, "escalated");
      return ok({ ...report, state: "escalated" });
    },
  };
  return core;
}
