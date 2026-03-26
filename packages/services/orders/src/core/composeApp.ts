import { ORBIT_MS, type ServiceDeps } from "@sudsnik/contracts";
import { serviceDataFile } from "@sudsnik/infra-boot";
import { openDb, type Db } from "@sudsnik/infra-db";
import { createBaseApp, type App, type SudsnikApp } from "@sudsnik/infra-http";
import { createOutbox, registerHandlers, type Outbox } from "@sudsnik/infra-queue";
import { everyGuarded } from "@sudsnik/infra-telemetry";
import { costOf } from "./cost.js";
import { bindEventSink } from "./eventSink.js";
import { OrderRepository } from "./OrderRepository.js";
import type { OrdersService } from "./OrdersService.js";
import { migrationsDir } from "./paths.js";
import { registerRoutes } from "./routes.js";

export const VERSION = "1.0.0";

export interface Composition {
  variant: string;
  repository?(db: Db): OrderRepository;
  service(parts: { repo: OrderRepository; outbox: Outbox; deps: ServiceDeps }): OrdersService;
}

/** Wires one OrdersService variant into the boundary of system-spec §5.1: db and migrations, outbox, handlers, routes, reconciliation, drain order. */
export async function composeApp(deps: ServiceDeps, c: Composition): Promise<App & { sudsnik: SudsnikApp }> {
  const app = await createBaseApp({ deps, version: VERSION, variant: c.variant, cost: () => costOf(deps) });
  const db = openDb({ path: serviceDataFile(deps), service: deps.service, meter: deps.meter, migrationsDir });
  app.sudsnik.registerStop(async () => db.close());
  const outbox = createOutbox(db, deps.bus);
  const repo = c.repository?.(db) ?? new OrderRepository(db);
  const service = c.service({ repo, outbox, deps });
  bindEventSink(deps, service);
  registerRoutes(app, service);
  outbox.start();
  app.sudsnik.registerStop(() => outbox.stop());
  for (const h of await registerHandlers(deps)) app.sudsnik.registerStop(h.stop);
  app.sudsnik.registerStop(everyGuarded(deps.clock, ORBIT_MS, "reconcile", () => service.reconcile(), deps.telemetry.logger));
  app.sudsnik.setReady(true);
  return app;
}
