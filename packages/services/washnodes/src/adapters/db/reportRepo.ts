import { eq } from "drizzle-orm";
import type { Db } from "@sudsnik/infra-db";
import type { ReportRecord, ReportRepo } from "../../ports/reportRepo.js";
import { washerReports } from "./schema.js";

type Row = typeof washerReports.$inferSelect;

function toRecord(r: Row): ReportRecord {
  return {
    reportId: r.reportId,
    tenantId: r.tenantId,
    ...(r.orderId ? { orderId: r.orderId } : {}),
    ...(r.podId ? { podId: r.podId } : {}),
    ...(r.washerId ? { washerId: r.washerId } : {}),
    ...(r.action ? { action: r.action } : {}),
  };
}

export function sqliteReportRepo(db: Db): ReportRepo {
  const get = (reportId: string) => {
    const row = db.orm.select().from(washerReports).where(eq(washerReports.reportId, reportId)).get();
    return row ? toRecord(row) : undefined;
  };
  return {
    get,
    upsert: (report) => {
      const known = { orderId: report.orderId, podId: report.podId, washerId: report.washerId, action: report.action };
      const set = Object.fromEntries(Object.entries(known).filter(([, v]) => v !== undefined));
      db.orm
        .insert(washerReports)
        .values({ reportId: report.reportId, tenantId: report.tenantId, ...set })
        .onConflictDoUpdate({ target: washerReports.reportId, set })
        .run();
      return get(report.reportId)!;
    },
  };
}
