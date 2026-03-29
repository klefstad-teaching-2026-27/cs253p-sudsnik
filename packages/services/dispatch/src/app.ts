import { fileURLToPath } from "node:url";
import { IdSchema, IdempotencyHeaders, type CostResponse, type ServiceDeps } from "@sudsnik/contracts";
import { Assignment, routes } from "@sudsnik/contracts/services/dispatch";
import { z } from "zod";
import { serviceDataFile } from "@sudsnik/infra-boot";
import { openDb } from "@sudsnik/infra-db";
import { createBaseApp, sendResult, type App, type SudsnikApp } from "@sudsnik/infra-http";
import { createOutbox, registerHandlers } from "@sudsnik/infra-queue";
import { everyGuarded, runAlerts } from "@sudsnik/infra-telemetry";
import { mapResult, ok } from "@sudsnik/kernel";
import { readEnv } from "./env.js";
import { createGate } from "./gate.js";
import { createIngest } from "./ingest.js";
import { createPublisher } from "./publisher.js";
import { bindRuntime } from "./runtime.js";
import { PICKUP_PUMP_EVERY_MS, WASHER_SWEEP_MS, createScheduler } from "./scheduler.js";
import { createStore, toAssignment } from "./store.js";
import type { StrategyFactory } from "./strategy.js";

export const VERSION = "1.0.0";
export const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));

const OrderParams = z.object({ orderId: IdSchema });

/** The process meter sink answers per service; a bare Meter (the test fake) has no ledger to report. */
export function costOf(deps: ServiceDeps): CostResponse {
  if ("cost" in deps.meter) return (deps.meter as { cost(service: string): CostResponse }).cost(deps.service);
  return { service: deps.service, sinceMs: 0, totalUnits: 0, byOperation: {}, byEndpoint: {} };
}

/** The app every scheduling variant shares; the variant supplies its strategy, its name, and its alert rules if it has any. */
export async function buildApp(deps: ServiceDeps, variant: string, strategy: StrategyFactory, alertsDir?: string): Promise<App & { sudsnik: SudsnikApp }> {
  const app = await createBaseApp({ deps, version: VERSION, variant, cost: () => costOf(deps) });
  const env = readEnv(deps.env);
  if (!env.ok) {
    // system-spec §5.1 item 7: a bad environment fails /ready, not the first request.
    deps.telemetry.logger.error("env_invalid", { error: env.error.message });
    return app;
  }

  const gate = createGate();
  const db = openDb({ path: serviceDataFile(deps), service: deps.service, meter: deps.meter, migrationsDir });
  const store = createStore(db);
  const outbox = createOutbox(db, deps.bus);
  const publisher = createPublisher(deps, outbox);
  const chosen = strategy(deps, store);
  const scheduler = createScheduler({ deps, db, store, outbox, publisher, gate, strategy: chosen, maxInflight: env.value.SUDSNIK_DISPATCH_MAX_INFLIGHT });
  const ingest = createIngest({ deps, db, store, outbox, publisher, trust: chosen.ingest, onArrived: () => scheduler.pumpArrivals() });
  bindRuntime(deps, { store, outbox, scheduler, ingest, gate });

  app.post("/assignments/pickup", { schema: { headers: IdempotencyHeaders, body: routes.schedulePickup.body, response: { 200: Assignment } } }, async (req, reply) =>
    sendResult(reply, await gate.run(() => scheduler.schedulePickup(req.body.orderId, req.ctx))),
  );
  app.post("/assignments/return", { schema: { headers: IdempotencyHeaders, body: routes.scheduleReturn.body, response: { 200: Assignment } } }, async (req, reply) =>
    sendResult(reply, await gate.run(() => scheduler.scheduleReturn(req.body.orderId, req.ctx))),
  );
  app.post("/assignments/:orderId/reassign", { schema: { headers: IdempotencyHeaders, params: OrderParams, response: { 200: Assignment } } }, async (req, reply) =>
    sendResult(reply, await gate.run(() => scheduler.reassign(req.params.orderId, req.ctx))),
  );
  app.get("/assignments/:orderId", { schema: { params: OrderParams, response: { 200: routes.get.response } } }, async (req, reply) =>
    sendResult(
      reply,
      await gate.run(async () => ok(store.assignments(req.params.orderId).map(toAssignment))),
    ),
  );
  app.post("/callbacks/relay", { schema: { body: routes.relayCallback.body, response: { 200: routes.relayCallback.response } } }, async (req, reply) =>
    sendResult(
      reply,
      mapResult(await gate.run(() => ingest.accept(req.body, req.ctx)), (v) => ({ accepted: true, duplicate: v.duplicate })),
    ),
  );

  // Stops run in reverse registration order (system-spec §5.1 item 8): the timers and the consumers stop first, the gate
  // waits for the work they started, the outbox publishes what that work wrote, and only then does the database close.
  outbox.start();
  app.sudsnik.registerStop(() => db.close());
  app.sudsnik.registerStop(() => outbox.stop());
  app.sudsnik.registerStop(() => gate.close());
  const handlers = await registerHandlers(deps);
  for (const h of handlers) app.sudsnik.registerStop(h.stop);
  const alerts = alertsDir ? await runAlerts({ dir: alertsDir, clock: deps.clock, telemetry: deps.telemetry, cost: () => costOf(deps) }) : undefined;
  app.sudsnik.registerStop(() => alerts?.stop());
  const log = deps.telemetry.logger;
  app.sudsnik.registerStop(everyGuarded(deps.clock, PICKUP_PUMP_EVERY_MS, "pickup_pump", () => (scheduler.queueHasWork() ? gate.sweep(() => scheduler.pumpPickups()) : undefined), log));
  app.sudsnik.registerStop(everyGuarded(deps.clock, WASHER_SWEEP_MS, "washer_sweep", () => gate.sweep(() => scheduler.pumpArrivals()), log));
  await scheduler.pumpPickups();
  await scheduler.pumpArrivals();
  app.sudsnik.setReady(true);
  return app;
}
