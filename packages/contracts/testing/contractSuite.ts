import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import type { z } from "zod";
import { IDEMPOTENCY_HEADER, TENANT_HEADER } from "../src/common.js";
import type { ServiceDeps } from "../src/deps.js";
import { declaredTopics, type Service, type Topic } from "../src/topics.js";
import { fakeDeps, type FakeDeps } from "./fakeDeps.js";

export interface RouteSpec {
  method: string;
  path: string;
  body?: z.ZodType;
  query?: z.ZodType;
  response?: z.ZodType;
  idempotent?: boolean;
}

interface InjectResponse {
  statusCode: number;
  json(): unknown;
  headers: Record<string, unknown>;
}

interface Injectable {
  inject(opts: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } | string): Promise<InjectResponse>;
  sudsnik: { isReady(): boolean; drain(): Promise<void> };
}

export interface ContractSuiteOptions {
  service: Service;
  routes: Record<string, RouteSpec>;
  createApp(deps: ServiceDeps): Promise<Injectable>;
  handlersDir: string;
  seed?: string;
  /** A schema-valid example body per route name; generated from the schema when absent. */
  examples?: Record<string, { body?: unknown; params?: Record<string, string>; query?: Record<string, string> }>;
  /** Extra setup on the fake deps before createApp (e.g. client fakes). */
  prepare?(deps: FakeDeps): void | Promise<void>;
}

type TestFn = (name: string, fn: () => Promise<void> | void) => void;
interface Framework {
  describe(name: string, fn: () => void): void;
  it: TestFn;
  expect(value: unknown): { toBe(v: unknown): void; not: { toBe(v: unknown): void }; toEqual(v: unknown): void; toBeDefined(): void; toContain(v: unknown): void };
  beforeAll(fn: () => Promise<void> | void): void;
  afterAll(fn: () => Promise<void> | void): void;
}

/**
 * The contract gate every service must pass (system-spec §8): the boundary of §5.1, every declared route reachable and
 * validated, writes needing an Idempotency-Key, and a handler for every consumed topic and none for any other.
 * Called from a service's test/contract/ with vitest's globals passed in.
 */
export function contractSuite(fw: Framework, opts: ContractSuiteOptions): void {
  const { describe, it, expect, beforeAll, afterAll } = fw;
  describe(`${opts.service} contract`, () => {
    let app: Injectable;
    let deps: FakeDeps;
    beforeAll(async () => {
      deps = fakeDeps(opts.seed ?? "00000000c0ffee00", opts.service, { handlersDir: opts.handlersDir });
      await opts.prepare?.(deps);
      app = await opts.createApp(deps);
    });
    afterAll(async () => {
      await app.sudsnik.drain();
    });

    it("serves /health, /ready, /cost, /version", async () => {
      expect((await app.inject("/health")).statusCode).toBe(200);
      expect((await app.inject("/ready")).statusCode).toBe(200);
      const v = (await app.inject("/version")).json() as { service: string; variant: string; contractsVersion: string };
      expect(v.service).toBe(opts.service);
      expect(typeof v.variant).toBe("string");
      const c = (await app.inject("/cost")).json() as { service: string; totalUnits: number };
      expect(c.service).toBe(opts.service);
      expect(typeof c.totalUnits).toBe("number");
    });

    it("rejects requests without a tenant and writes without an idempotency key", async () => {
      for (const [name, r] of Object.entries(opts.routes)) {
        if (r.path.startsWith("/callbacks/") || r.method === "ANY") continue;
        const url = fill(r.path, opts.examples?.[name]?.params);
        const noTenant = await app.inject({ method: r.method, url, payload: example(r, opts.examples?.[name]) });
        expect(noTenant.statusCode).toBe(401);
        if (r.method === "POST" || r.method === "PUT") {
          const noKey = await app.inject({ method: r.method, url, headers: { [TENANT_HEADER]: "op1" }, payload: example(r, opts.examples?.[name]) });
          expect(noKey.statusCode).toBe(400);
        }
      }
    });

    it("answers every declared route with a non-404, non-5xx status for a schema-valid request", async () => {
      for (const [name, r] of Object.entries(opts.routes)) {
        if (r.method === "ANY") continue;
        const url = fill(r.path, opts.examples?.[name]?.params) + qs(opts.examples?.[name]?.query);
        const res = await app.inject({ method: r.method, url, headers: { [TENANT_HEADER]: "op1", [IDEMPOTENCY_HEADER]: `contract-${name}` }, payload: example(r, opts.examples?.[name]) });
        if (res.statusCode === 404 || res.statusCode >= 500) throw new Error(`${name}: ${r.method} ${url} -> ${res.statusCode} ${JSON.stringify(res.json())}`);
      }
    });

    it("rejects a malformed body on every route with a body schema", async () => {
      for (const [name, r] of Object.entries(opts.routes)) {
        if (!r.body || r.method === "ANY") continue;
        const url = fill(r.path, opts.examples?.[name]?.params);
        const res = await app.inject({ method: r.method, url, headers: { [TENANT_HEADER]: "op1", [IDEMPOTENCY_HEADER]: `bad-${name}` }, payload: { definitely: "not valid", __n: 1 } });
        if (res.statusCode !== 400) throw new Error(`${name}: malformed body -> ${res.statusCode}`);
      }
    });

    it("has a handler for every consumed topic and for no other", async () => {
      const files = readdirSync(opts.handlersDir).filter((f) => /\.(ts|js)$/.test(f) && !f.endsWith(".d.ts"));
      const topics = new Set<Topic>();
      for (const f of files) {
        const mod = (await import(pathToFileURL(join(opts.handlersDir, f)).href)) as { default?: { topic?: Topic } };
        if (mod.default?.topic) topics.add(mod.default.topic);
      }
      const declared = new Set(declaredTopics[opts.service].consumes);
      for (const t of declared) if (!topics.has(t)) throw new Error(`no handler for consumed topic ${t}`);
      for (const t of topics) if (!declared.has(t)) throw new Error(`handler for undeclared topic ${t}`);
    });

    it("publishes only declared topics during the route sweep", () => {
      const allowed = new Set(declaredTopics[opts.service].publishes);
      for (const e of deps.bus.published) if (!allowed.has(e.topic)) throw new Error(`published undeclared topic ${e.topic}`);
    });
  });
}

function fill(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:(\w+)/g, (_, k: string) => encodeURIComponent(params[k] ?? "missing"));
}

function qs(q?: Record<string, string>): string {
  if (!q) return "";
  const s = new URLSearchParams(q).toString();
  return s ? `?${s}` : "";
}

function example(r: RouteSpec, ex?: { body?: unknown }): unknown {
  if (ex && "body" in ex) return ex.body;
  if (!r.body) return undefined;
  return exampleFor(r.body);
}

/** A best-effort schema-valid value from a zod schema; services pass explicit examples where this is not enough. */
export function exampleFor(schema: z.ZodType): unknown {
  const def = (schema as unknown as { def?: { type?: string; shape?: Record<string, z.ZodType>; innerType?: z.ZodType; element?: z.ZodType; entries?: Record<string, string>; values?: unknown[]; options?: z.ZodType[]; minimum?: number; checks?: unknown[] } }).def;
  if (!def) return undefined;
  switch (def.type) {
    case "object":
      return Object.fromEntries(Object.entries(def.shape ?? {}).map(([k, v]) => [k, exampleFor(v)]));
    case "string":
      return "example";
    case "number":
      return 1;
    case "int":
      return 1;
    case "boolean":
      return true;
    case "enum":
      return Object.values(def.entries ?? {})[0];
    case "literal":
      return (def.values ?? [])[0];
    case "array":
      return [];
    case "optional":
    case "nullable":
    case "default":
      return def.innerType ? exampleFor(def.innerType) : undefined;
    case "union":
      return def.options?.[0] ? exampleFor(def.options[0]) : undefined;
    case "record":
      return {};
    default:
      return undefined;
  }
}
