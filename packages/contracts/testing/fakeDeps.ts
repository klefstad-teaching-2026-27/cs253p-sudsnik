import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { metrics, trace } from "@opentelemetry/api";
import { SimClock, err, ok, subSeed, sudsnikError, type Result } from "@sudsnik/kernel";
import { UNIT_PRICES, type Op } from "../src/canon.js";
import type { Clients } from "../src/clients.js";
import type { Bus, CostEntry, Logger, Meter, ServiceDeps, Telemetry } from "../src/deps.js";
import type { Envelope } from "../src/envelope.js";
import { parseFlags } from "../src/flags.js";
import { DEFAULT_PORTS } from "../src/env.js";
import { MOCKS } from "../src/sim.js";
import { SERVICES, type Service, type Topic } from "../src/topics.js";

export class FakeBus implements Bus {
  readonly published: Envelope[] = [];
  private subs = new Map<Topic, Array<{ consumer: string; handler: (e: Envelope) => Promise<Result<void>> }>>();

  async publish(envelope: Envelope): Promise<void> {
    this.published.push(envelope);
  }

  subscribe(topic: Topic, handler: (e: Envelope) => Promise<Result<void>>, opts: { consumer: string }): () => void {
    const list = this.subs.get(topic) ?? [];
    const entry = { consumer: opts.consumer, handler };
    list.push(entry);
    this.subs.set(topic, list);
    return () => {
      this.subs.set(topic, (this.subs.get(topic) ?? []).filter((x) => x !== entry));
    };
  }

  /** Delivers one envelope to every subscriber; tests call it to simulate the bus. */
  async deliver(envelope: Envelope): Promise<Result<void>[]> {
    const out: Result<void>[] = [];
    for (const s of this.subs.get(envelope.topic) ?? []) out.push(await s.handler(envelope));
    return out;
  }

  ofTopic<P>(topic: Topic): Envelope<P>[] {
    return this.published.filter((e) => e.topic === topic) as Envelope<P>[];
  }
}

export class FakeMeter implements Meter {
  readonly byOperation: Record<string, CostEntry> = {};
  readonly byEndpoint: Record<string, CostEntry> = {};
  totalUnits = 0;

  charge(op: Op, count: number, tags: { service: string; endpoint?: string }): void {
    const units = UNIT_PRICES[op] * count;
    const o = (this.byOperation[op] ??= { count: 0, units: 0 });
    o.count += count;
    o.units += units;
    if (tags.endpoint) {
      const e = (this.byEndpoint[tags.endpoint] ??= { count: 0, units: 0 });
      e.count += count;
      e.units += units;
    }
    this.totalUnits += units;
  }
}

export class FakeLogger implements Logger {
  readonly records: Array<{ level: string; event: string; fields: Record<string, unknown> }> = [];
  constructor(private readonly base: Record<string, unknown> = {}) {}
  info(event: string, fields: Record<string, unknown> = {}) {
    this.records.push({ level: "info", event, fields: { ...this.base, ...fields } });
  }
  warn(event: string, fields: Record<string, unknown> = {}) {
    this.records.push({ level: "warn", event, fields: { ...this.base, ...fields } });
  }
  error(event: string, fields: Record<string, unknown> = {}) {
    this.records.push({ level: "error", event, fields: { ...this.base, ...fields } });
  }
  child(fields: Record<string, unknown>): Logger {
    const c = new FakeLogger({ ...this.base, ...fields });
    (c as { records: unknown[] }).records = this.records;
    return c;
  }
}

export function fakeTelemetry(service: string): Telemetry & { logger: FakeLogger } {
  const counters: Record<string, number> = {};
  return {
    tracer: trace.getTracer(service),
    meter: metrics.getMeter(service),
    logger: new FakeLogger({ service }),
    counter: (name) => ({ add: (n = 1) => (counters[name] = (counters[name] ?? 0) + n) }),
    counters: () => ({ ...counters }),
  };
}

function unavailable(name: string) {
  return () => Promise.resolve(err(sudsnikError("UNAVAILABLE", `fake client ${name} has no behaviour; override it in the test`)));
}

/** Clients whose every method fails UNAVAILABLE until a test overrides it with `withClient`. */
export function fakeClients(): Clients {
  const make = <T extends object>(name: string, methods: (keyof T)[]): T =>
    Object.fromEntries(methods.map((m) => [m, unavailable(`${name}.${String(m)}`)])) as T;
  return {
    orders: make("orders", ["place", "cancel", "get", "list"]),
    dispatch: make("dispatch", ["schedulePickup", "scheduleReturn", "reassign"]),
    washnodes: make("washnodes", ["acquireHold", "releaseHold", "startCycle", "status"]),
    billing: make("billing", ["quote", "authorize", "capture", "refund", "ledger"]),
    tracking: make("tracking", ["position", "positions", "podLocation"]),
    accounts: make("accounts", ["operator", "habitat", "crew", "updateOperator"]),
    notify: make("notify", ["send", "digest"]),
    support: make("support", ["report", "triage", "escalate"]),
    payments: make("payments", ["authorize", "capture", "refund"]),
    ephemeris: make("ephemeris", ["windows", "position", "status"]),
    identity: make("identity", ["token", "verify"]),
    washerV1: make("washerV1", ["hold", "status", "start", "release"]),
    washerV2: make("washerV2", ["createHold", "deleteHold", "startCycle", "cycle"]),
    relay: make("relay", ["deliver"]),
    oracle: make("oracle", ["complete"]),
  };
}

export function fakeEnv(service: Service, dataDir: string, seed: string): Record<string, string> {
  const env: Record<string, string> = {
    SUDSNIK_PORT: String(DEFAULT_PORTS[service]),
    SUDSNIK_SEED: seed,
    SUDSNIK_DATA_DIR: dataDir,
    SUDSNIK_BUS_URL: join(dataDir, "bus.sqlite"),
    SUDSNIK_CLOCK_RATE: "600",
    SUDSNIK_TENANT_KEYS: "op1:key1,op2:key2,op3:key3,op4:key4",
    SUDSNIK_FLAGS: "orders.enabled,dispatch.enabled,washnodes.enabled,billing.enabled,tracking.enabled,accounts.enabled,notify.enabled,support.enabled",
    SUDSNIK_SIM_URL: `http://127.0.0.1:${DEFAULT_PORTS.sim}`,
    NODE_ENV: "test",
  };
  for (const s of SERVICES) env[`SUDSNIK_${s.toUpperCase()}_URL`] = `http://127.0.0.1:${DEFAULT_PORTS[s]}`;
  for (const m of MOCKS) env[`SUDSNIK_${m.toUpperCase().replace("-", "_")}_URL`] = `http://127.0.0.1:${DEFAULT_PORTS[m]}`;
  return env;
}

export interface FakeDeps extends ServiceDeps {
  clock: SimClock;
  bus: FakeBus;
  meter: FakeMeter;
  telemetry: Telemetry & { logger: FakeLogger };
}

/**
 * ServiceDeps with in-memory fakes, deterministic from the seed. `handlersDir` defaults to
 * `<package>/src/handlers`; pass `overrides.handlersDir` to point elsewhere.
 */
export function fakeDeps(seed: string, service: Service, overrides: Partial<ServiceDeps> = {}): FakeDeps {
  const dataDir = overrides.dataDir ?? mkdtempSync(join(tmpdir(), `sudsnik-${service}-`));
  const env = overrides.env ?? fakeEnv(service, dataDir, subSeed(seed, service));
  const deps: FakeDeps = {
    service,
    env,
    clock: new SimClock(),
    bus: new FakeBus(),
    meter: new FakeMeter(),
    flags: parseFlags(env.SUDSNIK_FLAGS),
    clients: fakeClients(),
    telemetry: fakeTelemetry(service),
    dataDir,
    handlersDir: overrides.handlersDir ?? join(process.cwd(), "src", "handlers"),
    ...overrides,
  } as FakeDeps;
  return deps;
}

export { ok, err };
