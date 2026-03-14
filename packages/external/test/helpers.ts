import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { TENANT_HEADER, type FaultEvent, type MockName } from "@sudsnik/contracts";
import { subSeed } from "@sudsnik/kernel";
import { boundUrl, type MockStats } from "../src/index.js";

export const SEED = "00000000c0ffee00";
export const seedFor = (name: MockName): string => subSeed(SEED, name);
export const tmpDir = (): string => mkdtempSync(join(tmpdir(), "sudsnik-external-"));
export const tenant = (id = "op1"): Record<string, string> => ({ [TENANT_HEADER]: id });

export interface StateOverrides {
  clockMs?: number;
  orbit?: number;
  dark?: string[];
  faults?: FaultEvent[];
}

/** Posts `/_sim/state` and returns the status; `orbit` defaults to the orbit of `clockMs`. */
export async function setState(app: FastifyInstance, s: StateOverrides = {}): Promise<number> {
  const clockMs = s.clockMs ?? 0;
  const res = await app.inject({
    method: "POST",
    url: "/_sim/state",
    payload: { clockMs, orbit: s.orbit ?? Math.floor(clockMs / 5_400_000), dark: s.dark ?? [], faults: s.faults ?? [] },
  });
  return res.statusCode;
}

/** Reads `GET /_sim/stats`, which takes no tenant header. */
export async function readStats(app: FastifyInstance): Promise<MockStats> {
  const res = await app.inject({ method: "GET", url: "/_sim/stats" });
  if (res.statusCode !== 200) throw new Error(`/_sim/stats returned ${res.statusCode}`);
  return res.json() as MockStats;
}

export const fault = (mock: MockName, kind: string, params: Record<string, unknown>): FaultEvent => ({ atOrbit: 0, mock, kind, params });

export interface Receiver {
  url: string;
  /** Every body POSTed to any path, with the path and tenant header it arrived with. */
  received: Array<{ path: string; tenant: string | undefined; body: Record<string, unknown> }>;
  close(): Promise<void>;
}

/** A local HTTP receiver on an ephemeral port; stands in for relay or for a service's callback route. */
export async function startReceiver(status = 200): Promise<Receiver> {
  const app = Fastify();
  const received: Receiver["received"] = [];
  app.post("/*", async (req, reply) => {
    const t = req.headers[TENANT_HEADER];
    received.push({ path: req.url, tenant: Array.isArray(t) ? t[0] : t, body: req.body as Record<string, unknown> });
    return reply.code(status).send({ accepted: true, deliveryId: `rcv_${received.length}` });
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  return { url: boundUrl(app), received, close: () => app.close() };
}
