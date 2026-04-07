import { makeEnvelope, type Envelope, type ServiceDeps, type Topic, IDEMPOTENCY_HEADER, TENANT_HEADER } from "@sudsnik/contracts";
import { fakeDeps, type FakeDeps } from "@sudsnik/contracts/testing";
import { err, ok, sudsnikError, type Result } from "@sudsnik/kernel";
import type { NotifyApp } from "../src/app.js";
import { handlersDir } from "../src/app.js";

export const SEED = "00000000c0ffee00";
export const TENANT = "op1";
/** hab01 is in contact during the first ten minutes of every orbit. */
export const HABITAT = "hab01";

export interface Booted {
  deps: FakeDeps;
  app: NotifyApp;
  relayCalls: number;
}

export type CreateApp = (deps: ServiceDeps) => Promise<NotifyApp>;

export async function boot(createApp: CreateApp, prepare?: (deps: FakeDeps) => void): Promise<Booted> {
  const deps = fakeDeps(SEED, "notify", { handlersDir });
  const booted: Booted = { deps, app: undefined as never, relayCalls: 0 };
  relayAnswers(booted, () => ok({ deliveryId: `dlv-${booted.relayCalls}` }));
  prepare?.(deps);
  booted.app = await createApp(deps);
  return booted;
}

/** Relay answers with `answer` on every call, counting the calls. */
export function relayAnswers(b: Booted, answer: () => Result<{ deliveryId: string }>): void {
  b.deps.clients.relay.deliver = async () => {
    b.relayCalls++;
    return answer();
  };
}

export function relayDark(retryAfterSeconds: number): Result<{ deliveryId: string }> {
  const e = sudsnikError("UNAVAILABLE", "habitat is out of contact");
  return err({ ...e, cause: { status: 503, headers: { "retry-after": String(retryAfterSeconds) } } });
}

export function event<P>(topic: Topic, payload: P, tenantId = TENANT, occurredAt = 0): Envelope<P> {
  return makeEnvelope({ topic, tenantId, occurredAt, payload });
}

export function orderPlaced(orderId: string, habitatId = HABITAT): Envelope {
  return event("order.placed", { orderId, habitatId, podId: `${habitatId}-p001`, requestedAt: 0 });
}

export async function deliver(b: Booted, envelope: Envelope): Promise<Result<void>[]> {
  return b.deps.bus.deliver(envelope);
}

export const headers = (key = "k1"): Record<string, string> => ({ [TENANT_HEADER]: TENANT, [IDEMPOTENCY_HEADER]: key });

export async function digest(b: Booted, habitatId = HABITAT) {
  const res = await b.app.inject({ method: "GET", url: `/habitats/${habitatId}/digest`, headers: { [TENANT_HEADER]: TENANT } });
  return { status: res.statusCode, body: res.json() as { habitatId: string; pending: Array<{ notificationId: string; state: string; template: string }>; nextWindowAt: number } };
}

import { fileURLToPath } from "node:url";
import { serviceDataFile } from "@sudsnik/infra-boot";
import { openDb } from "@sudsnik/infra-db";
import { createOutbox } from "@sudsnik/infra-queue";
import type { Wiring } from "../src/app.js";
import { createStore } from "../src/queue/store.js";

const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));

/** The store, db, and outbox a stage needs, over a fresh SQLite file; for tests of stages without an app. */
export function wiring(deps: FakeDeps = fakeDeps(SEED, "notify", { handlersDir })): Wiring & { deps: FakeDeps } {
  const db = openDb({ path: serviceDataFile(deps), service: deps.service, meter: deps.meter, migrationsDir });
  return { deps, db, store: createStore(db), outbox: createOutbox(db, deps.bus) };
}
