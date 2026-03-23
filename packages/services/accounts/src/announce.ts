import type { ServiceDeps } from "@sudsnik/contracts";
import type { Db } from "@sudsnik/infra-db";
import type { Outbox } from "@sudsnik/infra-queue";
import { operatorUpdated } from "./publish.js";
import { operatorsRepository } from "./repositories/operators.js";

/**
 * The service owns the operator rows, so it republishes them on every boot: a consumer that has never seen an update
 * still learns each operator's tier, region, and currency. Each boot enqueues a fresh envelope carrying the current
 * row, so a consumer deduping on the envelope id takes the repeat and rewrites the same values.
 * A consumer need not exist yet: the pump failing leaves the rows unpublished for the outbox timer to retry.
 */
export async function announceOperators(deps: ServiceDeps, db: Db, outbox: Outbox): Promise<void> {
  const rows = operatorsRepository(db).all();
  const occurredAt = deps.clock.now();
  db.transaction(() => {
    for (const operator of rows) outbox.enqueue(operatorUpdated(operator, occurredAt));
  });
  try {
    await outbox.pump();
  } catch (e) {
    deps.telemetry.logger.warn("operator_announce_deferred", { operators: rows.length, error: String(e) });
  }
}
