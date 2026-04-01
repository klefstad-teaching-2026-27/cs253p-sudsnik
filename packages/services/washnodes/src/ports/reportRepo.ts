export interface ReportRecord {
  reportId: string;
  tenantId: string;
  orderId?: string;
  podId?: string;
  washerId?: string;
  action?: string;
}

/** Anomaly reports and their triage, recorded against the washer that washed the order. */
export interface ReportRepo {
  upsert(report: ReportRecord): ReportRecord;
  get(reportId: string): ReportRecord | undefined;
}
