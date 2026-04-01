import type { AnomalyReported, TriageCompleted } from "@sudsnik/contracts/events";
import type { CycleRepo } from "../ports/cycleRepo.js";
import type { ReportRepo } from "../ports/reportRepo.js";
import type { WasherRepo } from "../ports/washerRepo.js";

const MAINTENANCE_ACTIONS: ReadonlySet<string> = new Set(["quarantine", "escalate"]);

export interface ReportDeps {
  washers: WasherRepo;
  cycles: CycleRepo;
  reports: ReportRepo;
}

/** Anomaly reports recorded against the washer that washed the order last; a quarantine or escalation takes that washer out of service. */
export interface ReportFlow {
  reported(tenantId: string, p: AnomalyReported): void;
  triaged(tenantId: string, p: TriageCompleted): void;
}

export function createReportFlow(d: ReportDeps): ReportFlow {
  const washerFor = (orderId: string) => d.cycles.latestForOrder(orderId)?.washerId;
  return {
    reported(tenantId, p) {
      const washerId = washerFor(p.orderId);
      d.reports.upsert({ reportId: p.reportId, tenantId, orderId: p.orderId, podId: p.podId, ...(washerId ? { washerId } : {}) });
    },
    triaged(tenantId, p) {
      const washerId = washerFor(p.orderId);
      d.reports.upsert({ reportId: p.reportId, tenantId, orderId: p.orderId, podId: p.podId, action: p.action, ...(washerId ? { washerId } : {}) });
      if (washerId && MAINTENANCE_ACTIONS.has(p.action)) d.washers.setMaintenance(washerId);
    },
  };
}
