import { describe, expect, it } from "vitest";
import {
  HABITATS,
  OPERATORS,
  PUBLIC_SEED,
  SERVICES,
  TOPICS,
  declaredTopics,
  isHabitatVisible,
  LINK_WINDOW_MINUTES,
  makeEnvelope,
  nextWindowStart,
  operatorOfHabitat,
  parseFlags,
  parsePayload,
  payloadSchemas,
  CommonEnvSchema,
  MINUTE_MS,
  ORBIT_MS,
} from "../src/index.js";
import { fakeDeps, fakeEnv } from "../testing/fakeDeps.js";

describe("topics", () => {
  it("every topic has exactly one publisher and every consumer/publisher is declared", () => {
    for (const topic of TOPICS) {
      if (topic === "clock.tick") continue;
      const publishers = SERVICES.filter((s) => declaredTopics[s].publishes.includes(topic));
      expect(publishers, topic).toHaveLength(1);
      expect(payloadSchemas[topic]).toBeDefined();
    }
    for (const s of SERVICES) for (const t of declaredTopics[s].consumes) expect(TOPICS).toContain(t);
  });
  it("parses payloads by topic", () => {
    expect(() => parsePayload("order.placed", { orderId: "o1", habitatId: "hab01", podId: "p", requestedAt: 5 })).not.toThrow();
    expect(() => parsePayload("order.placed", { orderId: "o1" })).toThrow();
  });
});

describe("envelope", () => {
  it("fills system tenant on system topics and rejects a tenantless domain topic", () => {
    const e = makeEnvelope({ topic: "clock.tick", occurredAt: 0, payload: { nowMs: 0, orbit: 0, orbitPhase: 0 } });
    expect(e.tenantId).toBe("system");
    expect(e.correlationId).toBe(e.id);
    expect(() => makeEnvelope({ topic: "order.placed", occurredAt: 0, payload: {} })).toThrow();
  });
});

describe("canon", () => {
  it("assigns habitats to operators three each", () => {
    expect(HABITATS).toHaveLength(12);
    expect(operatorOfHabitat("hab01")).toBe("op1");
    expect(operatorOfHabitat("hab12")).toBe("op4");
    expect(OPERATORS).toHaveLength(4);
  });
  it("computes link windows from the habitat index", () => {
    expect(isHabitatVisible("hab01", 0)).toBe(true);
    expect(isHabitatVisible("hab01", 10 * MINUTE_MS)).toBe(false);
    expect(isHabitatVisible("hab02", 7.5 * MINUTE_MS)).toBe(true);
    expect(isHabitatVisible("hab12", 82.5 * MINUTE_MS + 1)).toBe(true);
    expect(nextWindowStart("hab01", 1)).toBe(ORBIT_MS);
    expect(nextWindowStart("hab02", 0)).toBe(7.5 * MINUTE_MS);
  });
  it("gives every habitat the same length of window, the last one wrapping the orbit", () => {
    for (const habitatId of HABITATS) {
      let visible = 0;
      for (let t = 0; t < ORBIT_MS; t += MINUTE_MS / 2) if (isHabitatVisible(habitatId, t)) visible += 0.5;
      expect(visible).toBe(LINK_WINDOW_MINUTES);
    }
    expect(isHabitatVisible("hab12", ORBIT_MS + MINUTE_MS)).toBe(true);
    expect(isHabitatVisible("hab12", ORBIT_MS + 3 * MINUTE_MS)).toBe(false);
  });
});

describe("flags and env", () => {
  it("parses flags and rejects unknown names", () => {
    expect(parseFlags("orders.enabled, api.v2").isOn("api.v2")).toBe(true);
    expect(parseFlags("").isOn("orders.enabled")).toBe(false);
    expect(() => parseFlags("nope")).toThrow();
  });
  it("validates the common env set and fails on a missing URL", () => {
    const env = fakeEnv("orders", "/tmp/x", PUBLIC_SEED);
    expect(CommonEnvSchema.safeParse(env).success).toBe(true);
    const { SUDSNIK_RELAY_URL: _drop, ...rest } = env;
    expect(CommonEnvSchema.safeParse(rest).success).toBe(false);
  });
});

describe("fakeDeps", () => {
  it("builds deterministic deps with fakes that fail loudly", async () => {
    const deps = fakeDeps(PUBLIC_SEED, "billing");
    expect(deps.clock.now()).toBe(0);
    const r = await deps.clients.payments.authorize({ orderId: "o", amount: 1, currency: "USD", callbackUrl: "http://x/cb" }, { tenantId: "op1", correlationId: "c" });
    expect(r.ok).toBe(false);
    deps.meter.charge("DB_WRITE", 2, { service: "billing", endpoint: "POST /charges/authorize" });
    expect(deps.meter.totalUnits).toBe(30);
  });
});

import { exampleFor } from "../testing/contractSuite.js";
import { PlaceOrder } from "../src/services/orders/routes.js";
describe("exampleFor", () => {
  it("builds a schema-valid example from a zod object", () => {
    expect(PlaceOrder.safeParse(exampleFor(PlaceOrder)).success).toBe(true);
  });
});
