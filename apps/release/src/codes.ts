/** Every finding code in a deploy log; each has a runbook entry in the student tree (autograder-spec §8.1). */
export const FINDING_CODES = {
  READY_TIMEOUT: "The stack did not answer /ready with 200 before the deadline",
  BOOT_CRASH: "The stack process exited before becoming ready",
  TOKEN_FAILED: "identity refused a token for an operator",
  PLACE_FAILED: "POST /v1/orders returned a non-2xx status",
  PLACE_SLOW: "Placement p95 exceeded the SLO",
  TURNAROUND_MISSED: "Fewer orders than the SLO fraction returned within 6 orbits",
  LOST_ON_DRAIN: "An accepted order was missing after SIGTERM",
  UNGRACEFUL_EXIT: "The stack did not exit within the drain deadline after SIGTERM",
  STUCK_ORDERS: "Orders were stuck at the end of the run",
  DEAD_LETTERS: "Messages were dead-lettered during the run",
  UNDECLARED_TOPIC: "A service published or consumed a topic it does not declare",
  TENANT_LEAK: "A response or event carried another tenant's id",
  INVARIANT_FAILED: "A scenario invariant failed",
  SIM_FAILED: "The simulator did not complete the run",
  DIRTY_ENVIRONMENT: "The data directory carried an earlier run's state, so this run could not be judged",
  RUN_DEADLINE: "The run passed its wall-clock deadline and was judged on what it reached",
  COST_UNAVAILABLE: "/cost could not be read",
  REPORT_FAILED: "POST /v1/support/reports returned a non-2xx status",
  CANCEL_FAILED: "An order could not be cancelled: the read before the cancel, or the cancel itself, returned a non-2xx status",
  RESTART_FAILED: "The stack did not come back from the mid-run restart the scenario asked for",
} as const;
export type FindingCode = keyof typeof FINDING_CODES;
