import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PUBLIC_SEED } from "@sudsnik/contracts";
import { FakeMeter, fakeEnv } from "@sudsnik/contracts/testing";
import { SimClock } from "@sudsnik/kernel";
import { createClients, createHttpClient } from "../src/index.js";
import { createWashnodesRpc } from "../src/legacy/washnodesRpc.js";

const server = Fastify();
const seen: Array<{ url: string; headers: Record<string, unknown>; body: unknown }> = [];
server.post("/orders", async (req) => (seen.push({ url: req.url, headers: req.headers, body: req.body }), { orderId: "o1" }));
server.get("/orders/:id", async (req, reply) => reply.code(404).send({ code: "NOT_FOUND", message: "nope", retryable: false }));
server.get("/quota", async (_req, reply) => reply.code(429).header("retry-after", "30").send({ code: "QUOTA", message: "slow down", retryable: true }));
server.get("/plain500", async (_req, reply) => reply.code(500).send("oops"));
server.get("/hang", () => new Promise<never>(() => {}));
server.get("/status/:w", async (req) => ({ washer: (req.params as { w: string }).w, state: "idle" }));
let base = "";
beforeAll(async () => {
  await server.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(server.server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

const ctx = { tenantId: "op1", correlationId: "c1", idempotencyKey: "k1" };

describe("http client", () => {
  it("sends tenant, correlation, and idempotency headers, meters call and connection", async () => {
    const meter = new FakeMeter();
    const http = createHttpClient({ service: "gateway", meter, clock: new SimClock(), timeoutMs: { internal: 5000, external: 2000 } });
    const r = await http.json<{ orderId: string }>({ method: "POST", url: `${base}/orders`, kind: "internal", ctx, body: { podId: "p" } });
    expect(r).toEqual({ ok: true, value: { orderId: "o1" } });
    expect(seen[0]!.headers["x-sudsnik-tenant"]).toBe("op1");
    expect(seen[0]!.headers["x-correlation-id"]).toBe("c1");
    expect(seen[0]!.headers["idempotency-key"]).toBe("k1");
    await http.json({ method: "POST", url: `${base}/orders`, kind: "internal", ctx: { tenantId: "op1", correlationId: "c2" }, body: {} });
    expect(seen[1]!.headers["idempotency-key"]).toMatch(/^[0-9A-Z]{26}$/);
    expect(meter.byOperation.INTERNAL_CALL?.count).toBe(2);
    expect(meter.byOperation.CONNECTION?.count).toBeGreaterThanOrEqual(1);
    expect(meter.byOperation.CONNECTION?.count).toBeLessThanOrEqual(2);
    await http.close();
  });

  it("maps error bodies, statuses, and plain-text failures", async () => {
    const http = createHttpClient({ service: "s", meter: new FakeMeter(), clock: new SimClock(), timeoutMs: { internal: 5000, external: 2000 } });
    const nf = await http.json({ method: "GET", url: `${base}/orders/x`, kind: "internal", ctx });
    expect(nf.ok).toBe(false);
    if (!nf.ok) expect(nf.error.code).toBe("NOT_FOUND");
    const q = await http.json({ method: "GET", url: `${base}/quota`, kind: "external", ctx });
    if (!q.ok) {
      expect(q.error.code).toBe("QUOTA");
      expect(q.error.retryable).toBe(true);
      expect((q.error.cause as { headers: Record<string, string> }).headers["retry-after"]).toBe("30");
    }
    const p = await http.json({ method: "GET", url: `${base}/plain500`, kind: "external", ctx });
    if (!p.ok) expect(p.error.code).toBe("INTERNAL");
    const down = await http.json({ method: "GET", url: "http://127.0.0.1:1/x", kind: "external", ctx });
    if (!down.ok) expect(down.error.code).toBe("UNAVAILABLE");
    await http.close();
  });

  it("times out on the simulated clock", async () => {
    const clock = new SimClock();
    const http = createHttpClient({ service: "s", meter: new FakeMeter(), clock, timeoutMs: { internal: 5000, external: 2000 } });
    const p = http.json({ method: "GET", url: `${base}/hang`, kind: "external", ctx });
    clock.advanceTo(60_000);
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("TIMEOUT");
    await http.close();
  });

  it("ends a hung call on the wall clock when one is configured, which no service does", async () => {
    // The simulated timeout above needs something to advance the clock. A caller holding a clock nobody advances
    // during its own call has only this one, so the driver sets it and the call still ends.
    const clock = new SimClock();
    const http = createHttpClient({ service: "driver", meter: new FakeMeter(), clock, timeoutMs: { internal: 5000, external: 5000 }, wallTimeoutMs: 40 });
    const r = await http.json({ method: "GET", url: `${base}/hang`, kind: "external", ctx });
    expect(clock.now()).toBe(0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("TIMEOUT");
    await http.close();
  });
});

describe("createClients", () => {
  it("binds every client to env URLs and fails on a missing one", () => {
    const env = fakeEnv("orders", "/tmp/x", PUBLIC_SEED);
    const c = createClients({ service: "orders", env, meter: new FakeMeter(), clock: new SimClock() });
    expect(Object.keys(c).sort()).toContain("washerV2");
    const { SUDSNIK_ORACLE_URL: _d, ...rest } = env;
    expect(() => createClients({ service: "orders", env: rest, meter: new FakeMeter(), clock: new SimClock() })).toThrow(/SUDSNIK_ORACLE_URL/);
  });
  it("legacy rpc shim maps methods to v1 routes", async () => {
    const http = createHttpClient({ service: "washnodes", meter: new FakeMeter(), clock: new SimClock(), timeoutMs: { internal: 5000, external: 2000 } });
    const rpc = createWashnodesRpc(http, base);
    const r = await rpc.invoke<{ washer: string }>("MachineStatus", { washer: "A1" }, ctx);
    expect(r).toEqual({ ok: true, value: { washer: "A1", state: "idle" } });
    await http.close();
  });
});
