import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PUBLIC_SEED } from "@sudsnik/contracts";
import { fakeDeps } from "@sudsnik/contracts/testing";
import { createMeterSink } from "@sudsnik/infra-metering";
import { err, ok, sudsnikError } from "@sudsnik/kernel";
import { createBaseApp, listen, sendResult } from "../src/index.js";

async function build(env: Record<string, string> = {}) {
  const sink = createMeterSink();
  const deps = fakeDeps(PUBLIC_SEED, "orders", { meter: sink });
  Object.assign(deps.env, env);
  const app = await createBaseApp({ deps, version: "1.0.0", variant: "golden", cost: () => sink.cost("orders") });
  let n = 0;
  app.post("/orders", { schema: { body: z.object({ podId: z.string() }) } }, async (req, reply) => {
    n++;
    sink.charge("DB_WRITE", 1, { service: "orders" });
    return sendResult(reply, ok({ orderId: `o${n}`, podId: req.body.podId, tenant: req.ctx.tenantId }), 201);
  });
  app.get("/orders/:id", async (req, reply) => sendResult(reply, err(sudsnikError("NOT_FOUND", `no ${(req.params as { id: string }).id}`))));
  app.get("/boom", async () => {
    throw new Error("kaboom");
  });
  return { app, deps, sink, calls: () => n };
}

const h = { "x-sudsnik-tenant": "op1", "idempotency-key": "k1" };

describe("base app", () => {
  it("serves health, ready, version, cost, and openapi", async () => {
    const { app } = await build();
    expect((await app.inject("/health")).statusCode).toBe(200);
    expect((await app.inject("/ready")).statusCode).toBe(503);
    app.sudsnik.setReady(true);
    expect((await app.inject("/ready")).json()).toEqual({ ready: true, service: "orders" });
    expect((await app.inject("/version")).json()).toMatchObject({ service: "orders", variant: "golden" });
    expect((await app.inject("/cost")).statusCode).toBe(200);
    expect((await app.inject("/openapi.json")).json().paths["/orders"]).toBeDefined();
  });

  it("requires tenant and idempotency key on writes and replays duplicates", async () => {
    const { app, calls } = await build();
    expect((await app.inject({ method: "POST", url: "/orders", payload: { podId: "p" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/orders", payload: { podId: "p" }, headers: { "x-sudsnik-tenant": "op1" } })).json().code).toBe("INVALID");
    const first = await app.inject({ method: "POST", url: "/orders", payload: { podId: "p" }, headers: h });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: "POST", url: "/orders", payload: { podId: "p" }, headers: h });
    expect(second.json()).toEqual(first.json());
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(calls()).toBe(1);
    const other = await app.inject({ method: "POST", url: "/orders", payload: { podId: "p" }, headers: { ...h, "x-sudsnik-tenant": "op2" } });
    expect(other.json().orderId).toBe("o2");
    const g1 = await app.inject({ url: "/orders/a", headers: h });
    const g2 = await app.inject({ url: "/orders/b", headers: h });
    expect(g2.json().message).not.toBe(g1.json().message);
  });

  it("maps Result errors, validation errors, and thrown errors", async () => {
    const { app } = await build();
    const nf = await app.inject({ url: "/orders/zz", headers: { "x-sudsnik-tenant": "op1" } });
    expect(nf.statusCode).toBe(404);
    expect(nf.json().code).toBe("NOT_FOUND");
    const bad = await app.inject({ method: "POST", url: "/orders", payload: { nope: 1 }, headers: h });
    expect(bad.statusCode).toBe(400);
    const boom = await app.inject({ url: "/boom", headers: { "x-sudsnik-tenant": "op1" } });
    expect(boom.statusCode).toBe(500);
    expect(boom.json()).toMatchObject({ code: "INTERNAL", message: "kaboom" });
    expect((await app.inject({ url: "/nothing", headers: { "x-sudsnik-tenant": "op1" } })).json().code).toBe("NOT_FOUND");
  });

  it("propagates correlation ids and attributes metering to the endpoint", async () => {
    const { app, deps, sink } = await build();
    const r = await app.inject({ method: "POST", url: "/orders", payload: { podId: "p" }, headers: { ...h, "x-correlation-id": "corr-1" } });
    expect(r.headers["x-correlation-id"]).toBe("corr-1");
    expect(sink.cost("orders").byEndpoint["POST /orders"]?.count).toBe(1);
    expect(deps.telemetry.logger.records.filter((x) => x.level === "error")).toHaveLength(0);
  });

  it("guards /cost in production", async () => {
    const { app, deps } = await build({ NODE_ENV: "production" });
    expect((await app.inject("/cost")).statusCode).toBe(401);
    deps.clients.identity.verify = async () => ok({ operatorId: "op1", scopes: ["cost"] });
    expect((await app.inject({ url: "/cost", headers: { authorization: "Bearer t" } })).statusCode).toBe(200);
  });

  it("tears down what the process owns only after every service stop has run", async () => {
    const { app } = await build();
    const order: string[] = [];
    app.sudsnik.registerStop(() => order.push("db.close"));
    app.sudsnik.registerStop(() => order.push("outbox.stop"));
    const handle = await listen(app, 0, { handleSigterm: false, afterDrain: async () => void order.push("ctx.close") });
    expect(handle.port).toBeGreaterThan(0);
    await handle.close();
    // Reverse registration order, and the process context last: a stop that closed the bus mid-drain would
    // strand whatever the service still had to publish.
    expect(order).toEqual(["outbox.stop", "db.close", "ctx.close"]);
  });

  it("drains: runs stops in reverse and becomes unready", async () => {
    const { app } = await build();
    const order: string[] = [];
    app.sudsnik.registerStop(() => order.push("a"));
    app.sudsnik.registerStop(async () => void order.push("b"));
    app.sudsnik.setReady(true);
    await app.sudsnik.drain();
    expect(order).toEqual(["b", "a"]);
    expect(app.sudsnik.isReady()).toBe(false);
  });
});
