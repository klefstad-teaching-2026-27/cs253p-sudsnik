import type { ServiceDeps } from "@sudsnik/contracts";
import type { Db } from "@sudsnik/infra-db";
import type { Outbox } from "@sudsnik/infra-queue";
import type { CycleFlow } from "./app/cycles.js";
import type { ReportFlow } from "./app/reports.js";
import type { WashnodesUseCases } from "./app/service.js";
import type { Dedupe } from "./ports/dedupe.js";

/** What a running instance exposes to its handlers and its tests. */
export interface Runtime {
  db: Db;
  outbox: Outbox;
  service: WashnodesUseCases;
  cycles: CycleFlow;
  reports: ReportFlow;
  events: Dedupe;
}

const runtimes = new WeakMap<ServiceDeps, Runtime>();

/** Handlers are loaded by directory scan and receive only `deps`; the instance built for those deps is found here. */
export function bindRuntime(deps: ServiceDeps, runtime: Runtime): void {
  runtimes.set(deps, runtime);
}

export function runtimeOf(deps: ServiceDeps): Runtime | undefined {
  return runtimes.get(deps);
}
