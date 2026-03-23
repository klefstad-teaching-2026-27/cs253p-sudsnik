import type { Ctx, ServiceDeps } from "@sudsnik/contracts";
import { ORBIT_MS } from "@sudsnik/contracts/canon";
import type { AccountsService, Crew, Habitat, Operator, OperatorPatch } from "@sudsnik/contracts/services/accounts";
import { createCache } from "@sudsnik/infra-cache";
import type { Db } from "@sudsnik/infra-db";
import type { Outbox } from "@sudsnik/infra-queue";
import { ok, type Result } from "@sudsnik/kernel";
import { isNoop, operatorUpdated } from "../../publish.js";
import { crewsRepository } from "../../repositories/crews.js";
import { habitatsRepository } from "../../repositories/habitats.js";
import { operatorsRepository } from "../../repositories/operators.js";
import { owned } from "../../tenant.js";

const CACHE_MAX = 256;

/** Reads are served from a cache of rows keyed by id; a tenant check runs on every call, cached or not. */
export function goldenService(deps: ServiceDeps, db: Db, outbox: Outbox): AccountsService {
  const operators = operatorsRepository(db);
  const habitats = habitatsRepository(db);
  const crews = crewsRepository(db);
  const cacheOpts = { max: CACHE_MAX, ttlMs: ORBIT_MS, clock: deps.clock, meter: deps.meter, service: deps.service };
  const operatorCache = createCache<Operator>(cacheOpts);
  const habitatCache = createCache<Habitat>(cacheOpts);
  const crewCache = createCache<Crew[]>(cacheOpts);

  function cached<V>(cache: ReturnType<typeof createCache<V>>, key: string, load: () => V | undefined): V | undefined {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const row = load();
    if (row !== undefined) cache.set(key, row);
    return row;
  }

  const habitat = (habitatId: string, ctx: Ctx): Result<Habitat> => {
    const row = cached(habitatCache, habitatId, () => habitats.get(habitatId));
    return owned(row, row?.operatorId, ctx.tenantId, "habitat");
  };

  return {
    async operator(operatorId, ctx) {
      const row = cached(operatorCache, operatorId, () => operators.get(operatorId));
      return owned(row, row?.operatorId, ctx.tenantId, "operator");
    },
    async habitat(habitatId, ctx) {
      return habitat(habitatId, ctx);
    },
    async crew(habitatId, ctx) {
      const h = habitat(habitatId, ctx);
      if (!h.ok) return h;
      return ok(cached(crewCache, habitatId, () => crews.byHabitat(habitatId)) ?? []);
    },
    async updateOperator(operatorId, patch: OperatorPatch, ctx) {
      const current = owned(operators.get(operatorId), operatorId, ctx.tenantId, "operator");
      if (!current.ok || isNoop(current.value, patch)) return current;
      const next: Operator = { ...current.value, ...patch };
      db.transaction(() => {
        operators.update(operatorId, patch);
        outbox.enqueue(operatorUpdated(next, deps.clock.now(), ctx.correlationId));
      });
      operatorCache.delete(operatorId);
      await outbox.pump();
      return ok(next);
    },
  };
}
