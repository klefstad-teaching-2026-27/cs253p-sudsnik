import { fileURLToPath } from "node:url";
import type { CostResponse, Meter, ServiceDeps } from "@sudsnik/contracts";
import type { SupportEnv, TriageWorkflow } from "@sudsnik/contracts/services/support";
import { openDb, type Db } from "@sudsnik/infra-db";
import { serviceDataFile } from "@sudsnik/infra-boot";
import { createBaseApp, type App, type SudsnikApp } from "@sudsnik/infra-http";
import { createOutbox, registerHandlers, type Outbox } from "@sudsnik/infra-queue";
import { readEnv } from "./env.js";
import { bindHandlers } from "./handlerContext.js";
import { registerRoutes } from "./routes.js";
import { createSupportService, type SupportCore } from "./service.js";
import { createStore, type Store } from "./store.js";

export const VERSION = "1.0.0";
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));

export interface SupportInternals {
  db: Db;
  store: Store;
  outbox: Outbox;
  workflow: TriageWorkflow;
  service: SupportCore;
}

/** `support` is absent only when `deps.env` failed validation; the app then never reports ready (system-spec §5.1 item 7). */
export type SupportApp = App & { sudsnik: SudsnikApp; support?: SupportInternals };

export interface BuildOptions {
  variant: string;
  workflow(ctx: { deps: ServiceDeps; store: Store; env: SupportEnv }): TriageWorkflow;
}

/** The meter a process hands out is its sink; a fake meter has no per-service view, so /cost reports zero. */
export function costOf(deps: ServiceDeps): CostResponse {
  const meter = deps.meter as Meter & { cost?: (service: string) => CostResponse };
  return meter.cost ? meter.cost(deps.service) : { service: deps.service, sinceMs: 0, totalUnits: 0, byOperation: {}, byEndpoint: {} };
}

/** Everything but the workflow is shared by every variant. */
export async function buildApp(deps: ServiceDeps, opts: BuildOptions): Promise<SupportApp> {
  const app: SupportApp = await createBaseApp({ deps, version: VERSION, variant: opts.variant, cost: () => costOf(deps) });
  const env = readEnv(deps.env);
  if (!env.ok) {
    deps.telemetry.logger.error("env_invalid", { error: env.error.message });
    return app;
  }
  const db = openDb({ path: serviceDataFile(deps), service: deps.service, meter: deps.meter, migrationsDir });
  app.sudsnik.registerStop(() => db.close());
  const store = createStore(db);
  const outbox = createOutbox(db, deps.bus);
  const workflow = opts.workflow({ deps, store, env: env.value });
  const service = createSupportService({ deps, db, store, outbox, workflow });
  registerRoutes(app, service);
  bindHandlers(deps, { db, store, service });
  outbox.start();
  app.sudsnik.registerStop(() => outbox.stop());
  for (const h of await registerHandlers(deps)) app.sudsnik.registerStop(h.stop);
  app.support = { db, store, outbox, workflow, service };
  app.sudsnik.setReady(true);
  return app;
}
