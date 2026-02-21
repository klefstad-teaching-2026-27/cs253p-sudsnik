import { describe, expect, it } from "vitest";
import { createMeterSink, scopedMeter, unitsPer10k } from "../src/index.js";

describe("meter sink", () => {
  it("prices operations and splits by service and endpoint", () => {
    const sink = createMeterSink(0);
    sink.charge("DB_READ", 3, { service: "orders", endpoint: "GET /orders/:id" });
    sink.charge("LLM_TOKEN", 100, { service: "support" });
    expect(sink.cost("orders").totalUnits).toBe(24);
    expect(sink.cost("orders").byEndpoint["GET /orders/:id"]).toEqual({ count: 3, units: 24 });
    expect(sink.cost("support").totalUnits).toBe(5);
    expect(sink.cost("nothing").totalUnits).toBe(0);
    expect(sink.services().sort()).toEqual(["nothing", "orders", "support"]);
  });
  it("scoped meters fill service and endpoint", () => {
    const sink = createMeterSink();
    scopedMeter(sink, "billing", "POST /x").charge("CACHE_WRITE", 1, { service: "ignored" });
    expect(sink.cost("billing").byEndpoint["POST /x"]?.units).toBe(6);
  });
  it("rejects bad input", () => {
    const sink = createMeterSink();
    expect(() => sink.charge("NOPE" as never, 1, { service: "s" })).toThrow();
    expect(() => sink.charge("DB_READ", -1, { service: "s" })).toThrow();
  });
  it("normalizes to units per 10k orders", () => {
    expect(unitsPer10k([{ service: "a", sinceMs: 0, totalUnits: 500, byOperation: {}, byEndpoint: {} }], 50)).toBe(100_000);
    expect(unitsPer10k([], 0)).toBe(0);
  });
});

import { runWithEndpoint } from "../src/index.js";
describe("endpoint context", () => {
  it("attributes charges without an endpoint to the running endpoint", () => {
    const sink = createMeterSink();
    runWithEndpoint("POST /orders", () => sink.charge("DB_WRITE", 1, { service: "orders" }));
    sink.charge("DB_WRITE", 1, { service: "orders" });
    expect(sink.cost("orders").byEndpoint["POST /orders"]?.count).toBe(1);
    expect(sink.cost("orders").byOperation.DB_WRITE?.count).toBe(2);
  });
});
