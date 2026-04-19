import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_SEED, type Service, type ServiceDeps } from "@sudsnik/contracts";
import { fakeEnv } from "@sudsnik/contracts/testing";
import { createBaseApp, sendResult } from "@sudsnik/infra-http";
import { ok } from "@sudsnik/kernel";
import { withDefaults } from "../src/env.js";
import { createSingleStack } from "../src/single.js";

describe("env defaults", () => {
  it("fills unset variables and keeps set ones", () => {
    const env = withDefaults({ SUDSNIK_PORT: "5000" }, { single: true });
    expect(env.SUDSNIK_ORDERS_URL).toBe("http://127.0.0.1:5000/orders");
    expect(env.SUDSNIK_PORT).toBe("5000");
    expect(withDefaults({}, { single: false }).SUDSNIK_BILLING_URL).toBe("http://127.0.0.1:4004");
  });
});

describe("single stack", () => {
  it("mounts enabled services, forwards with the prefix stripped, and aggregates ready and cost", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sudsnik-single-"));
    const env = { ...fakeEnv("gateway", dir, PUBLIC_SEED), SUDSNIK_FLAGS: "orders.enabled" };
    const load = async (service: Service) => ({
      service,
      readEnv: () => ok({}),
      handlersDir: dir,
      start: async () => undefined,
      createApp: async (deps: ServiceDeps) => {
        const app = await createBaseApp({ deps, version: "1", variant: "test", cost: () => ({ service, sinceMs: 0, totalUnits: 1, byOperation: {}, byEndpoint: {} }) });
        app.get("/echo", async (req, reply) => sendResult(reply, ok({ service, tenant: req.ctx.tenantId, url: req.url })));
        app.sudsnik.setReady(service === "orders");
        return app;
      },
    });
    const stack = await createSingleStack(env, load);
    expect([...stack.apps.keys()]).toEqual(["gateway", "orders"]);
    const port = await stack.listen(0);
    const base = `http://127.0.0.1:${port}`;
    const echo = await fetch(`${base}/orders/echo?x=1`, { headers: { "x-sudsnik-tenant": "op1" } });
    expect(await echo.json()).toEqual({ service: "orders", tenant: "op1", url: "/echo?x=1" });
    const ready = await fetch(`${base}/ready`);
    expect(ready.status).toBe(503);
    stack.apps.get("gateway")!.sudsnik.setReady(true);
    expect((await fetch(`${base}/ready`)).status).toBe(200);
    const cost = (await (await fetch(`${base}/cost`)).json()) as { service: string }[];
    expect(cost.map((c) => c.service)).toEqual(["gateway", "orders"]);
    expect((await fetch(`${base}/nope/x`)).status).toBe(404);
    await stack.drain();
  });
});
