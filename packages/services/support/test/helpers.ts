import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IDEMPOTENCY_HEADER, PUBLIC_SEED, TENANT_HEADER, type OracleClient, type ServiceDeps } from "@sudsnik/contracts";
import type { Report, TriageResult } from "@sudsnik/contracts/services/support";
import { fakeDeps, fakeEnv, type FakeDeps } from "@sudsnik/contracts/testing";
import { createMock, loadFixtures, type LoadedFixture } from "@sudsnik/external/oracle";
import { newId, subSeed } from "@sudsnik/kernel";
import type { SupportApp, SupportInternals } from "../src/app.js";
import { oracleOverInject } from "../src/eval/oracle.js";
// The selector, so this helper works in any tree: the starter ships one variant and `src/index.ts` names it (§8).
import { createApp as selectedApp, handlersDir as selectedHandlers } from "../src/index.js";

export const TENANT = "op1";

export interface CountingOracle extends OracleClient {
  calls(): number;
  close(): Promise<void>;
}

/** The real oracle mock, in process, with a call counter. */
export async function oracleMock(dataDir: string): Promise<CountingOracle> {
  const mock = await createMock({ seed: subSeed(PUBLIC_SEED, "oracle"), dataDir });
  const inner = oracleOverInject(mock);
  let calls = 0;
  return {
    complete: (prompt, maxTokens, ctx) => {
      calls++;
      return inner.complete(prompt, maxTokens, ctx);
    },
    calls: () => calls,
    close: () => mock.close(),
  };
}

export interface Booted {
  app: SupportApp;
  internals: SupportInternals;
  deps: FakeDeps;
  oracle: CountingOracle;
  close(): Promise<void>;
}

export interface BootOptions {
  createApp?: (deps: ServiceDeps) => Promise<SupportApp>;
  handlersDir?: string;
  env?: Record<string, string>;
}

export async function boot(opts: BootOptions = {}): Promise<Booted> {
  const dataDir = mkdtempSync(join(tmpdir(), "sudsnik-support-test-"));
  const handlersDir = opts.handlersDir ?? selectedHandlers;
  const env = { ...fakeEnv("support", dataDir, subSeed(PUBLIC_SEED, "support")), ...opts.env };
  const deps = fakeDeps(PUBLIC_SEED, "support", { handlersDir, dataDir, env });
  const oracle = await oracleMock(dataDir);
  deps.clients.oracle = oracle;
  const app = await (opts.createApp ?? selectedApp)(deps);
  if (!app.support) throw new Error("app has no internals; env invalid?");
  return {
    app,
    internals: app.support,
    deps,
    oracle,
    close: async () => {
      await app.sudsnik.drain();
      await oracle.close();
    },
  };
}

export function headers(key: string | undefined = newId()): Record<string, string> {
  return { [TENANT_HEADER]: TENANT, ...(key ? { [IDEMPOTENCY_HEADER]: key } : {}) };
}

export async function postReport(app: SupportApp, body: { orderId?: string; podId?: string; note: string }, key?: string): Promise<{ status: number; report: Report }> {
  const res = await app.inject({ method: "POST", url: "/reports", headers: headers(key), payload: { orderId: "ord1", podId: "hab01-p001", ...body } });
  return { status: res.statusCode, report: res.json() as Report };
}

export async function postTriage(app: SupportApp, reportId: string): Promise<{ status: number; triage: TriageResult }> {
  const res = await app.inject({ method: "POST", url: `/reports/${reportId}/triage`, headers: headers() });
  return { status: res.statusCode, triage: res.json() as TriageResult };
}

export function fixturesOf(set: "triage" | "hostile"): LoadedFixture[] {
  return loadFixtures().filter((f) => f.name.startsWith(`${set}/`));
}

export function fixtureRows(set: "triage" | "hostile") {
  return fixturesOf(set).map((f) => ({ name: f.name, fixtureSet: set, note: f.note, ...f.expected, injected: f.injected }));
}
