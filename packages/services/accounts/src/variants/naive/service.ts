import type { ServiceDeps } from "@sudsnik/contracts";
import type { AccountsService, Operator, OperatorPatch } from "@sudsnik/contracts/services/accounts";
import type { Db } from "@sudsnik/infra-db";
import type { Outbox } from "@sudsnik/infra-queue";
import { ok } from "@sudsnik/kernel";
import { isNoop, operatorUpdated } from "../../publish.js";
import { crewsRepository } from "../../repositories/crews.js";
import { habitatsRepository } from "../../repositories/habitats.js";
import { operatorsRepository } from "../../repositories/operators.js";
import { owned } from "../../tenant.js";

/** No cache: every read is a fresh query, and crew joins habitat and operator on every call. */
export function naiveService(deps: ServiceDeps, db: Db, outbox: Outbox): AccountsService {
  const operators = operatorsRepository(db);
  const habitats = habitatsRepository(db);
  const crews = crewsRepository(db);
  return {
    async operator(operatorId, ctx) {
      const row = operators.get(operatorId);
      return owned(row, row?.operatorId, ctx.tenantId, "operator");
    },
    async habitat(habitatId, ctx) {
      const row = habitats.get(habitatId);
      return owned(row, row?.operatorId, ctx.tenantId, "habitat");
    },
    async crew(habitatId, ctx) {
      const rows = crews.byHabitatWithOperator(habitatId);
      const h = habitats.get(habitatId);
      const check = owned(h, h?.operatorId, ctx.tenantId, "habitat");
      if (!check.ok) return check;
      return ok(rows.map((r) => r.crew));
    },
    async updateOperator(operatorId, patch: OperatorPatch, ctx) {
      const current = owned(operators.get(operatorId), operatorId, ctx.tenantId, "operator");
      if (!current.ok || isNoop(current.value, patch)) return current;
      const next: Operator = { ...current.value, ...patch };
      db.transaction(() => {
        operators.update(operatorId, patch);
        outbox.enqueue(operatorUpdated(next, deps.clock.now(), ctx.correlationId));
      });
      await outbox.pump();
      return ok(next);
    },
  };
}
