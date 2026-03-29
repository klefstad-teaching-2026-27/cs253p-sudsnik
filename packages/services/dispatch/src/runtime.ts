import type { ServiceDeps } from "@sudsnik/contracts";
import type { Ctx } from "@sudsnik/contracts";
import type { Envelope } from "@sudsnik/contracts";
import type { Outbox } from "@sudsnik/infra-queue";
import { err, sudsnikError, type Result } from "@sudsnik/kernel";
import type { Gate } from "./gate.js";
import type { Ingest } from "./ingest.js";
import type { Scheduler } from "./scheduler.js";
import type { Store } from "./store.js";

export interface Runtime {
  store: Store;
  outbox: Outbox;
  scheduler: Scheduler;
  ingest: Ingest;
  gate: Gate;
}

/**
 * Handlers are discovered by directory scan and receive only `ServiceDeps`, so the app that owns the
 * database publishes its runtime here, keyed by the deps object it was built from.
 */
const runtimes = new WeakMap<ServiceDeps, Runtime>();

export function bindRuntime(deps: ServiceDeps, runtime: Runtime): void {
  runtimes.set(deps, runtime);
}

export function runtimeFor(deps: ServiceDeps): Result<Runtime> {
  const rt = runtimes.get(deps);
  if (!rt) return err(sudsnikError("UNAVAILABLE", "dispatch runtime is not bound to these deps"));
  return { ok: true, value: rt };
}

/** One bus delivery as one unit of work the drain knows about: it waits for this one and refuses the next. */
export function withRuntime(deps: ServiceDeps, handle: (runtime: Runtime) => Promise<Result<void>>): Promise<Result<void>> {
  const rt = runtimeFor(deps);
  if (!rt.ok) return Promise.resolve(rt);
  return rt.value.gate.run(() => handle(rt.value));
}

export function ctxOf(envelope: Envelope, idempotencyKey?: string): Ctx {
  return { tenantId: envelope.tenantId, correlationId: envelope.correlationId, ...(idempotencyKey ? { idempotencyKey } : {}) };
}
