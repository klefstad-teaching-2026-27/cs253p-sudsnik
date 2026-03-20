import { z } from "zod";
import { IdSchema, SimMsSchema, type ServiceDeps } from "@sudsnik/contracts";
import { OperatorUpdated } from "@sudsnik/contracts/events";
import type { Db } from "@sudsnik/infra-db";

export const OperatorRoute = OperatorUpdated.extend({ updatedAt: SimMsSchema });
export type OperatorRoute = z.infer<typeof OperatorRoute>;

const OperatorRow = z.object({
  tenantId: IdSchema,
  operator_id: IdSchema,
  region: OperatorUpdated.shape.region,
  pricing_tier: OperatorUpdated.shape.pricingTier,
  currency: OperatorUpdated.shape.currency,
  updated_at: SimMsSchema,
});

export interface OperatorStore {
  /** Idempotent on the envelope id; an older update never overwrites a newer record. */
  apply(tenantId: string, envelopeId: string, record: OperatorRoute): "applied" | "duplicate";
  get(tenantId: string, operatorId: string): OperatorRoute | undefined;
}

export const createOperatorStore = (db: Db): OperatorStore => ({
  apply: (tenantId, envelopeId, record) =>
    db.transaction(() => {
      const seen = db.write("insert or ignore into handled_events (envelope_id, topic, handled_at) values (?, 'operator.updated', ?)", envelopeId, record.updatedAt);
      if (seen.changes === 0) return "duplicate";
      db.write(
        `insert into operators (tenant_id, operator_id, region, pricing_tier, currency, updated_at) values (?, ?, ?, ?, ?, ?)
         on conflict (tenant_id, operator_id) do update set region = excluded.region, pricing_tier = excluded.pricing_tier, currency = excluded.currency, updated_at = excluded.updated_at
         where excluded.updated_at >= operators.updated_at`,
        tenantId,
        record.operatorId,
        record.region,
        record.pricingTier,
        record.currency,
        record.updatedAt,
      );
      return "applied";
    }),
  get: (tenantId, operatorId) => {
    const row = db.readOne("select tenant_id as tenantId, operator_id, region, pricing_tier, currency, updated_at from operators where tenant_id = ? and operator_id = ?", tenantId, operatorId);
    const parsed = OperatorRow.safeParse(row);
    return parsed.success
      ? { operatorId: parsed.data.operator_id, region: parsed.data.region, pricingTier: parsed.data.pricing_tier, currency: parsed.data.currency, updatedAt: parsed.data.updated_at }
      : undefined;
  },
});

// Handlers are discovered by directory scan and receive only ServiceDeps, so the app publishes its store here,
// keyed by the deps object it was built from. Every service in a process shares a data directory, and a test
// builds more than one app over the same one, so the deps object is the only key that names exactly this app.
const bound = new WeakMap<ServiceDeps, OperatorStore>();

export const bindOperatorStore = (deps: ServiceDeps, store: OperatorStore): (() => void) => {
  bound.set(deps, store);
  return () => void (bound.get(deps) === store && bound.delete(deps));
};

export const operatorStoreFor = (deps: ServiceDeps): OperatorStore | undefined => bound.get(deps);
