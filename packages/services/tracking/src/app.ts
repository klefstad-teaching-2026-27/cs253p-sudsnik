import { makeEnvelope, type CostResponse, type Ctx, type ServiceDeps } from "@sudsnik/contracts";
import type { RelayCallback } from "@sudsnik/contracts/mocks/relay";
import { TrackingEnvSchema, type Position } from "@sudsnik/contracts/services/tracking";
import { readEnvWith } from "@sudsnik/infra-boot";
import { createBaseApp, type App, type SudsnikApp } from "@sudsnik/infra-http";
import { createOutbox, registerHandlers, type Outbox } from "@sudsnik/infra-queue";
import { err, ok, sudsnikError, type Result } from "@sudsnik/kernel";
import { checksumVerifies } from "./checksum.js";
import { registerRoutes, type Accepted, type Tracking } from "./routes.js";
import { openStore, type Store, type StoredPosition } from "./store.js";

export const VERSION = "1.0.0";
/** Five minutes: a link window is ten, so a cached position never outlives the window it was taken in. */
export const DEFAULT_TTL_MS = 300_000;

export interface Parts {
  deps: ServiceDeps;
  store: Store;
  outbox: Outbox;
  ttlMs: number;
}

export function cost(deps: ServiceDeps): CostResponse {
  const meter = deps.meter as { cost?: (service: string) => CostResponse };
  return meter.cost ? meter.cost(deps.service) : { service: deps.service, sinceMs: 0, totalUnits: 0, byOperation: {}, byEndpoint: {} };
}

export const cached = (p: StoredPosition): Position => ({ ...p, source: "cached" });

/**
 * A stateful variant's app: base app, store with migrations, outbox, handlers, routes from `service`, ready.
 * A missing or invalid environment leaves the app not ready (system-spec §5.1 item 7).
 */
export async function buildApp(deps: ServiceDeps, variant: string, service: (parts: Parts) => Tracking): Promise<App & { sudsnik: SudsnikApp; outbox: Outbox }> {
  const env = readEnvWith(TrackingEnvSchema, deps.env);
  const app = await createBaseApp({ deps, version: VERSION, variant, cost: () => cost(deps), ready: () => env.ok });
  const store = openStore(deps);
  const outbox = createOutbox(store.db, deps.bus);
  outbox.start();
  const handlers = await registerHandlers(deps);
  // Stops run in reverse: handlers first, then the outbox's final pump, then the store it pumps from.
  app.sudsnik.registerStop(() => store.close());
  app.sudsnik.registerStop(() => outbox.stop());
  app.sudsnik.registerStop(() => handlers.forEach((h) => h.stop()));
  registerRoutes(app, service({ deps, store, outbox, ttlMs: env.ok ? env.value.SUDSNIK_TRACKING_CACHE_TTL_MS : DEFAULT_TTL_MS }));
  app.decorate("outbox", outbox);
  app.sudsnik.setReady(true);
  return app as typeof app & { outbox: Outbox };
}

/**
 * The relay ingest every stateful variant shares: checksum, dedupe on the body id, keep the newest observation,
 * publish `position.updated` through the outbox with it. `remember` sees each observation that was applied.
 */
export async function ingest({ deps, store, outbox }: Parts, body: RelayCallback, ctx: Ctx, remember?: (p: StoredPosition) => void): Promise<Result<Accepted>> {
  if (!checksumVerifies(body)) {
    store.reject(body.id, body, deps.clock.now());
    return err(sudsnikError("INVALID", "checksum does not verify"));
  }
  if (body.kind !== "position") return err(sudsnikError("INVALID", `tracking takes position callbacks, not ${body.kind}`));
  const p: StoredPosition = { shuttleId: body.shuttleId, orbitPhase: body.orbitPhase, observedAt: body.atMs };
  let duplicate = false;
  let applied = false;
  store.db.transaction(() => {
    if (!store.firstSeen("callbacks", body.id)) {
      duplicate = true;
      return;
    }
    applied = store.putPosition(p);
    if (applied) outbox.enqueue(makeEnvelope({ topic: "position.updated", occurredAt: deps.clock.now(), correlationId: ctx.correlationId, payload: p }));
  });
  if (applied) remember?.(p);
  return ok({ accepted: true, duplicate });
}

export function podLocation({ store }: Parts): Tracking["podLocation"] {
  return async (podId, ctx) => {
    const row = store.location(podId);
    if (!row || row.tenantId !== ctx.tenantId) return err(sudsnikError("NOT_FOUND", `no pod ${podId}`));
    const { tenantId: _tenant, ...location } = row;
    return ok(location);
  };
}

export const fresh = (p: { shuttleId: string; orbitPhase: number; atMs: number }): Position => ({ shuttleId: p.shuttleId, orbitPhase: p.orbitPhase, observedAt: p.atMs, source: "fresh" });
