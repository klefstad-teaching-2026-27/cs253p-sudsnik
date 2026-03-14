import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { IDEMPOTENCY_HEADER } from "@sudsnik/contracts";
import { PAYMENTS_QUOTA_PER_ORBIT, createMock } from "../src/payments/index.js";
import { fault, readStats, seedFor, setState, startReceiver, tenant, tmpDir, type Receiver } from "./helpers.js";

const authorize = (app: FastifyInstance, orderId: string, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url: "/authorize", headers: { ...tenant(), ...headers }, payload: { orderId, amount: 4900, currency: "USD", callbackUrl: "http://127.0.0.1:1/callbacks" } });

describe("payments", () => {
  let relay: Receiver;
  let app: FastifyInstance;
  beforeAll(async () => {
    relay = await startReceiver();
    app = await createMock({ seed: seedFor("payments"), dataDir: tmpDir(), relayUrl: relay.url });
    await setState(app, { clockMs: 0, faults: [fault("payments", "timeout-rate", { rate: 0 }), fault("payments", "duplicate-webhook-rate", { rate: 0 })] });
  });
  afterAll(async () => {
    await app.close();
    await relay.close();
  });

  it("authorizes, captures with a webhook through relay, and refunds", async () => {
    const auth = await authorize(app, "o1");
    expect(auth.statusCode).toBe(201);
    const { paymentRef } = auth.json();
    expect(auth.json()).toMatchObject({ state: "authorized", amount: 4900, currency: "USD" });
    const cap = await app.inject({ method: "POST", url: "/capture", headers: tenant(), payload: { paymentRef } });
    expect(cap.statusCode).toBe(200);
    expect(cap.json().state).toBe("captured");
    expect(relay.received).toHaveLength(1);
    expect(relay.received[0]).toMatchObject({ path: "/deliver", tenant: "op1", body: { to: "http://127.0.0.1:1/callbacks", path: "/payments", origin: { kind: "ground" } } });
    expect(relay.received[0]!.body.body).toMatchObject({ paymentRef, orderId: "o1", event: "captured", amount: 4900 });
    const again = await app.inject({ method: "POST", url: "/capture", headers: tenant(), payload: { paymentRef } });
    expect(again.statusCode).toBe(409);
    const refund = await app.inject({ method: "POST", url: "/refund", headers: tenant(), payload: { paymentRef, amount: 1000 } });
    expect(refund.json()).toMatchObject({ state: "refunded", amount: 1000 });
    expect(relay.received[1]!.body.body).toMatchObject({ event: "refunded", amount: 1000 });
    const other = await app.inject({ method: "POST", url: "/capture", headers: tenant("op2"), payload: { paymentRef } });
    expect(other.statusCode).toBe(404);
  });

  it("replays an Idempotency-Key with the first reply", async () => {
    const first = await authorize(app, "o2", { [IDEMPOTENCY_HEADER]: "k-o2" });
    const second = await authorize(app, "o2", { [IDEMPOTENCY_HEADER]: "k-o2" });
    expect(second.statusCode).toBe(201);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.json()).toEqual(first.json());
    const third = await authorize(app, "o2", { [IDEMPOTENCY_HEADER]: "k-other" });
    expect(third.json().paymentRef).not.toBe(first.json().paymentRef);
  });

  it("sends a duplicate webhook under a duplicate-webhook-rate fault", async () => {
    await setState(app, { clockMs: 60_000, faults: [fault("payments", "timeout-rate", { rate: 0 }), fault("payments", "duplicate-webhook-rate", { rate: 1 })] });
    const before = relay.received.length;
    const { paymentRef } = (await authorize(app, "o3")).json();
    await app.inject({ method: "POST", url: "/capture", headers: tenant(), payload: { paymentRef } });
    const sent = relay.received.slice(before);
    expect(sent).toHaveLength(2);
    expect((sent[0]!.body.body as { id: string }).id).toBe((sent[1]!.body.body as { id: string }).id);
  });

  it("holds a timed-out call and destroys its socket at the next /_sim/state", async () => {
    await setState(app, { clockMs: 120_000, faults: [fault("payments", "timeout-rate", { rate: 1 })] });
    const pending = authorize(app, "o4");
    let settled = false;
    void pending.then(() => (settled = true), () => (settled = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);
    await setState(app, { clockMs: 180_000, faults: [fault("payments", "timeout-rate", { rate: 0 })] });
    await expect(pending).rejects.toThrow("timeout fault");
  });

  it("returns 429 with Retry-After past the per-tenant per-orbit quota and resets on the next orbit", async () => {
    const fresh = await createMock({ seed: seedFor("payments"), dataDir: tmpDir(), relayUrl: relay.url });
    await setState(fresh, { clockMs: 0, faults: [fault("payments", "timeout-rate", { rate: 0 })] });
    for (let i = 0; i < PAYMENTS_QUOTA_PER_ORBIT; i++) expect((await authorize(fresh, `q${i}`)).statusCode).toBe(201);
    const over = await authorize(fresh, "q-over");
    expect(over.statusCode).toBe(429);
    expect(over.headers["retry-after"]).toBe("5400");
    expect((await authorize(fresh, "q-op2", tenant("op2"))).statusCode).toBe(201);
    await setState(fresh, { clockMs: 5_400_000, faults: [fault("payments", "timeout-rate", { rate: 0 })] });
    expect((await authorize(fresh, "q-next")).statusCode).toBe(201);
    await fresh.close();
  });

  it("counts every quota refusal at /_sim/stats, per tenant, and keeps the count across orbits", async () => {
    const noTimeouts = [fault("payments", "timeout-rate", { rate: 0 })];
    const fresh = await createMock({ seed: seedFor("payments"), dataDir: tmpDir(), relayUrl: relay.url });
    await setState(fresh, { clockMs: 0, faults: noTimeouts });
    for (let i = 0; i < PAYMENTS_QUOTA_PER_ORBIT; i++) expect((await authorize(fresh, `c${i}`)).statusCode).toBe(201);
    expect((await authorize(fresh, "c-over")).statusCode).toBe(429);
    expect((await authorize(fresh, "c-over2")).statusCode).toBe(429);
    expect((await authorize(fresh, "c-op2", tenant("op2"))).statusCode).toBe(201);
    expect(await readStats(fresh)).toEqual({ quotaRefusals: { total: 2, byTenant: { op1: 2 } } });
    await setState(fresh, { clockMs: 5_400_000, faults: noTimeouts });
    expect((await authorize(fresh, "c-next")).statusCode).toBe(201);
    expect(await readStats(fresh)).toEqual({ quotaRefusals: { total: 2, byTenant: { op1: 2 } } });
    await fresh.close();
  });

  it("is deterministic under the seed", async () => {
    const run = async () => {
      const a = await createMock({ seed: seedFor("payments"), dataDir: tmpDir(), relayUrl: relay.url });
      await setState(a, { clockMs: 0, faults: [fault("payments", "timeout-rate", { rate: 0 })] });
      const before = relay.received.length;
      const refs: string[] = [];
      for (let i = 0; i < 60; i++) {
        const { paymentRef } = (await authorize(a, `d${i}`)).json();
        refs.push(paymentRef);
        await a.inject({ method: "POST", url: "/capture", headers: tenant(), payload: { paymentRef } });
      }
      await a.close();
      return { refs, webhooks: relay.received.slice(before).map((r) => (r.body.body as { id: string }).id) };
    };
    const x = await run();
    const y = await run();
    expect(x).toEqual(y);
    expect(x.webhooks.length).toBeGreaterThan(60);
  });
});
