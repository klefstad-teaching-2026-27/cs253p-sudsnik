import { fileURLToPath } from "node:url";
import { createHttpClient, DEFAULT_TIMEOUTS, type HttpClient } from "@sudsnik/clients";
import { createWashnodesRpc, type WashnodesRpc } from "@sudsnik/clients/legacy/washnodesRpc";
import { MINUTE_MS, ORBIT_MS, mockUrlVar, serviceUrlVar, type CostResponse, type ServiceDeps } from "@sudsnik/contracts";
import { openDb, type Db } from "@sudsnik/infra-db";
import type { HoldStore } from "@sudsnik/contracts/services/washnodes";
import { createBaseApp, type App, type SudsnikApp } from "@sudsnik/infra-http";
import type { MeterSink } from "@sudsnik/infra-metering";
import { createOutbox, registerHandlers } from "@sudsnik/infra-queue";
import { everyGuarded } from "@sudsnik/infra-telemetry";
import { ok } from "@sudsnik/kernel";
import { serviceDataFile } from "@sudsnik/infra-boot";
import pkg from "../../package.json" with { type: "json" };
import { callbackDedupe, eventDedupe } from "../adapters/db/dedupe.js";
import { seedFleet } from "../adapters/db/fleet.js";
import { sqliteNodeRepo } from "../adapters/db/nodeRepo.js";
import { sqliteReportRepo } from "../adapters/db/reportRepo.js";
import { outboxPublisher } from "../adapters/outboxPublisher.js";
import { v1Adapter } from "../adapters/v1.js";
import { v2Adapter } from "../adapters/v2.js";
import { V1_POLL_MS, V2_RECONCILE_AFTER_MS } from "../domain/cycle.js";
import { registerRoutes } from "../http/routes.js";
import type { CycleRepo } from "../ports/cycleRepo.js";
import type { WasherRepo } from "../ports/washerRepo.js";
import { bindRuntime, type Runtime } from "../runtime.js";
import { createCycleFlow } from "./cycles.js";
import { createReportFlow } from "./reports.js";
import { createService } from "./service.js";

export const migrationsDir = fileURLToPath(new URL("../../migrations/", import.meta.url));
export const sharedHandlersDir = fileURLToPath(new URL("../handlers/", import.meta.url));
export const VERSION: string = pkg.version;

export type WashnodesApp = App & { sudsnik: SudsnikApp; washnodes: Runtime };

export interface AppOptions {
  /** The legacy v1 RPC shim; tests pass a fake, production builds one over the metered HTTP client. */
  v1Rpc?: WashnodesRpc;
}

export interface Profile {
  washers(db: Db, deps: ServiceDeps): WasherRepo;
  holds(db: Db, washers: WasherRepo): HoldStore;
  cycles(db: Db): CycleRepo;
  /** How often the v2 reconciliation sweep runs, and how stale a running cycle must be for it to read it back. */
  reconcile: { everyMs: number; staleAfterMs: number };
}

/**
 * When the v2 reconciliation sweep looks, and how stale a running cycle must be for it to read back. Every
 * variant shares it. On `dark-side` the sweep is what recovers a `washer-v2` completion the relay held while a
 * node was dark, and turnaround is the only band graded there, so a variant sweeping sooner or with a shorter
 * threshold would recover work faster and invert the ordering `docs/system-spec.md` §8 rule 3 requires. A
 * variant differs in what a sweep costs, never in when it runs.
 */
/** Every five minutes, which is the shortest interval the v2 callback budget allows. */
const RECONCILE_WHEN_STALE = { everyMs: ORBIT_MS, staleAfterMs: V2_RECONCILE_AFTER_MS };

/** The sweep every variant shares; a variant brings only its storage (§8: the starter ships one variant alone). */
export const RECONCILE: Profile["reconcile"] = RECONCILE_WHEN_STALE;

export function costOf(deps: ServiceDeps): () => CostResponse {
  return () => ("cost" in deps.meter ? (deps.meter as MeterSink).cost(deps.service) : { service: deps.service, sinceMs: 0, totalUnits: 0, byOperation: {}, byEndpoint: {} });
}

function rpcFor(deps: ServiceDeps): WashnodesRpc {
  // Production clients carry the metered HTTP client they were built on; the test fakes do not.
  const http = (deps.clients as Partial<{ http: HttpClient }>).http ?? createHttpClient({ service: deps.service, meter: deps.meter, clock: deps.clock, timeoutMs: DEFAULT_TIMEOUTS });
  return createWashnodesRpc(http, (deps.env[mockUrlVar("washer-v1")] ?? "").replace(/\/$/, ""));
}

export async function composeApp(deps: ServiceDeps, variant: string, profile: Profile, opts: AppOptions = {}): Promise<WashnodesApp> {
  const app = await createBaseApp({ deps, version: VERSION, variant, cost: costOf(deps) });
  const db = openDb({ path: serviceDataFile(deps), service: deps.service, meter: deps.meter, migrationsDir });
  seedFleet(db);
  const outbox = createOutbox(db, deps.bus);
  const washers = profile.washers(db, deps);
  const holds = profile.holds(db, washers);
  const cycles = profile.cycles(db);
  const nodes = sqliteNodeRepo(db);
  const publish = outboxPublisher(outbox, deps.clock);
  const callbackUrl = `${(deps.env[serviceUrlVar("washnodes")] ?? "").replace(/\/$/, "")}/callbacks`;
  const firmware = { v1: v1Adapter(opts.v1Rpc ?? rpcFor(deps), deps.clients.washerV1), v2: v2Adapter(deps.clients.washerV2, callbackUrl) };
  const logger = deps.telemetry.logger;
  const service = createService({ clock: deps.clock, logger, washers, holds, cycles, nodes, firmware, publish });
  const flow = createCycleFlow({ clock: deps.clock, logger, service, washers, holds, cycles, nodes, firmware, publish, callbacks: callbackDedupe(db), reconcileStaleAfterMs: profile.reconcile.staleAfterMs });
  const runtime: Runtime = { db, outbox, service, cycles: flow, reports: createReportFlow({ washers, cycles, reports: sqliteReportRepo(db) }), events: eventDedupe(db) };
  bindRuntime(deps, runtime);
  app.decorate("washnodes", runtime);

  registerRoutes(app, { service, callback: (body) => ok(flow.callback(body)) });
  const handlers = await registerHandlers(deps, sharedHandlersDir);
  const timers = [
    everyGuarded(deps.clock, MINUTE_MS, "sweep", flow.sweep, logger),
    everyGuarded(deps.clock, V1_POLL_MS, "poll_v1", flow.pollV1, logger),
    everyGuarded(deps.clock, profile.reconcile.everyMs, "reconcile_v2", flow.reconcileV2, logger),
  ];
  outbox.start();

  // Stops run in reverse: timers and handlers first, then the outbox's final pump, then the database.
  app.sudsnik.registerStop(async () => db.close());
  app.sudsnik.registerStop(() => outbox.stop());
  app.sudsnik.registerStop(() => handlers.forEach((h) => h.stop()));
  app.sudsnik.registerStop(() => timers.forEach((stop) => stop()));
  app.sudsnik.setReady(true);
  return app as WashnodesApp;
}
