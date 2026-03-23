import { makeEnvelope, type Envelope } from "@sudsnik/contracts";
import type { Operator } from "@sudsnik/contracts/services/accounts";
import type { OperatorUpdated } from "@sudsnik/contracts/events";

/** Without a correlationId the envelope correlates to itself, which is what a startup announcement wants. */
export function operatorUpdated(operator: Operator, occurredAt: number, correlationId?: string): Envelope<OperatorUpdated> {
  // Sent once per operator at startup and never again; a later change goes out on `operator.changed`.
  return makeEnvelope({
    topic: "operator.updated",
    tenantId: operator.operatorId,
    occurredAt,
    ...(correlationId ? { correlationId } : {}),
    payload: { operatorId: operator.operatorId, pricingTier: operator.pricingTier, region: operator.region, currency: operator.currency },
  });
}

/** True when applying `patch` would leave `operator` unchanged. */
export function isNoop(operator: Operator, patch: Partial<Operator>): boolean {
  return Object.entries(patch).every(([k, v]) => v === undefined || operator[k as keyof Operator] === v);
}
