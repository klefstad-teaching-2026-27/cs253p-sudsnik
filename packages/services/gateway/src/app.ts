import { createHttpClient, type HttpClient } from "@sudsnik/clients";
import type { ServiceDeps } from "@sudsnik/contracts";
import { serviceDataFile } from "@sudsnik/infra-boot";
import { openDb } from "@sudsnik/infra-db";
import { createBaseApp, type App, type SudsnikApp } from "@sudsnik/infra-http";
import { registerHandlers } from "@sudsnik/infra-queue";
import { costOf } from "./cost.js";
import { bindOperatorStore, createOperatorStore, type OperatorStore } from "./operators/store.js";
import { handlersDir, migrationsDir } from "./paths.js";
import { FORWARD_TIMEOUT_MS } from "./upstream.js";

export const VERSION = "1.0.0";

export interface GatewayApp extends App {
  sudsnik: SudsnikApp;
}

export interface VariantParts {
  deps: ServiceDeps;
  http: HttpClient;
  store: OperatorStore;
}

export interface Variant {
  name: string;
  /**
   * Registers the variant's port routes; everything else in the app is shared. A variant that forwards builds
   * its own routing table, since which surfaces a version can reach is the variant's to say (`routing.ts`).
   */
  register(app: App, parts: VariantParts): void;
}

export interface CreateAppOptions {
  /** Tests inject a fake; production builds the one raw client the gateway is allowed. */
  http?: HttpClient;
}

export const createGatewayApp = async (deps: ServiceDeps, variant: Variant, opts: CreateAppOptions = {}): Promise<GatewayApp> => {
  const app = await createBaseApp({ deps, version: VERSION, variant: variant.name, cost: () => costOf(deps) });
  const db = openDb({ path: serviceDataFile(deps), service: deps.service, meter: deps.meter, migrationsDir });
  const store = createOperatorStore(db);
  const unbind = bindOperatorStore(deps, store);
  const http = opts.http ?? createHttpClient({ service: deps.service, meter: deps.meter, clock: deps.clock, timeoutMs: { internal: FORWARD_TIMEOUT_MS, external: FORWARD_TIMEOUT_MS } });
  variant.register(app, { deps, http, store });
  const handlers = await registerHandlers(deps, handlersDir);
  app.sudsnik.registerStop(() => handlers.forEach((h) => h.stop()));
  app.sudsnik.registerStop(unbind);
  if (!opts.http) app.sudsnik.registerStop(() => http.close());
  app.sudsnik.registerStop(() => db.close());
  app.sudsnik.setReady(true);
  return app;
};
