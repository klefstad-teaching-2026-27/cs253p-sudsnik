/**
 * @deprecated Retained for billing's original ledger import; new code uses Order from services/orders.
 * Superseded by ADR-0007 (`docs/adr/`).
 */
export interface LegacyOrder {
  id: string;
  customer: string;
  habitat: string;
  pod: string;
  created: number;
  status: "NEW" | "IN_PROGRESS" | "DONE" | "VOID";
  amountCents: number;
}
