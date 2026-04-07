import { fileURLToPath } from "node:url";
import { IdempotencyHeaders, MINUTE_MS, type CostResponse, type ServiceDeps } from "@sudsnik/contracts";
import { Digest, Notification, SendNotification, routes, type NotifyService } from "@sudsnik/contracts/services/notify";
import { serviceDataFile } from "@sudsnik/infra-boot";
import { openDb, type Db } from "@sudsnik/infra-db";
import { createBaseApp, sendResult, type App, type SudsnikApp } from "@sudsnik/infra-http";
import type { MeterSink } from "@sudsnik/infra-metering";
import { createOutbox, registerHandlers, type Outbox } from "@sudsnik/infra-queue";
import { everyGuarded, runAlerts } from "@sudsnik/infra-telemetry";
import { z } from "zod";
import { bindRuntime, type Runtime } from "./runtime.js";
import { createStore, type Store } from "./queue/store.js";

export const VERSION = "1.0.0";
export const handlersDir = fileURLToPath(new URL("./handlers/", import.meta.url));
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));

export interface Wiring {
  deps: ServiceDeps;
  db: Db;
  store: Store;
  outbox: Outbox;
}

/** What a variant supplies on top of the shared app: the port, the ingest, and an optional sweep. */
export interface VariantRuntime extends Runtime, NotifyService {
  /** Runs (or joins) one pass over queued notifications; tests await it after advancing the clock. */
  sweep(): Promise<void>;
  stop(): void;
}

export interface VariantSpec {
  variant: string;
  /** Directory of this variant's alert rules, absent where it has none; a variant that ships rules names its own. */
  alertsDir?: string;
  runtime(w: Wiring): VariantRuntime;
}

export type NotifyApp = App & { sudsnik: SudsnikApp; notify: { sweep(): Promise<void>; pump(): Promise<number> } };

export function costOf(deps: ServiceDeps): CostResponse {
  return "cost" in deps.meter ? (deps.meter as MeterSink).cost(deps.service) : { service: deps.service, sinceMs: 0, totalUnits: 0, byOperation: {}, byEndpoint: {} };
}

const HabitatParams = z.object({ habitatId: z.string().min(1) });

export async function createServiceApp(deps: ServiceDeps, spec: VariantSpec): Promise<NotifyApp> {
  const app = await createBaseApp({ deps, version: VERSION, variant: spec.variant, cost: () => costOf(deps) });
  const db = openDb({ path: serviceDataFile(deps), service: deps.service, meter: deps.meter, migrationsDir });
  const store = createStore(db);
  const outbox = createOutbox(db, deps.bus);
  const rt = spec.runtime({ deps, db, store, outbox });
  bindRuntime(deps, rt);

  app.post(routes.send.path, { schema: { headers: IdempotencyHeaders, body: SendNotification, response: { 201: Notification } } }, async (req, reply) =>
    sendResult(reply, await rt.send(req.body, req.ctx), 201),
  );
  app.get(routes.digest.path, { schema: { params: HabitatParams, response: { 200: Digest } } }, async (req, reply) => sendResult(reply, await rt.digest(req.params.habitatId, req.ctx)));

  outbox.start();
  const handlers = await registerHandlers(deps, handlersDir);
  const alerts = spec.alertsDir ? await runAlerts({ dir: spec.alertsDir, clock: deps.clock, telemetry: deps.telemetry, cost: () => costOf(deps) }) : undefined;
  const sweeper = everyGuarded(deps.clock, MINUTE_MS, "sweep", () => rt.sweep(), deps.telemetry.logger);

  // Stops run in reverse: the sweep and consumers first, then the outbox's final pump, then the db.
  app.sudsnik.registerStop(() => db.close());
  app.sudsnik.registerStop(() => outbox.stop());
  app.sudsnik.registerStop(() => rt.stop());
  for (const h of handlers) app.sudsnik.registerStop(h.stop);
  app.sudsnik.registerStop(() => alerts?.stop());
  app.sudsnik.registerStop(() => sweeper());

  app.decorate("notify", { sweep: () => rt.sweep(), pump: () => outbox.pump() });
  app.sudsnik.setReady(true);
  return app as NotifyApp;
}

