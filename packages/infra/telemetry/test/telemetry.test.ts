import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SimClock } from "@sudsnik/kernel";
import { createTelemetryProvider, everyGuarded, runAlerts } from "../src/index.js";

describe("telemetry", () => {
  it("writes spans with sim.now and logs per service as JSONL", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sudsnik-otel-"));
    const clock = new SimClock();
    clock.advanceTo(120_000);
    const provider = createTelemetryProvider({ dataDir, clock });
    const t = provider.forService("orders");
    const span = t.tracer.startSpan("http POST /orders");
    span.end();
    t.logger.info("placed", { orderId: "o1" });
    t.counter("orders.placed").add(2);
    expect(t.counters()).toEqual({ "orders.placed": 2 });
    const spans = readFileSync(join(dataDir, "otel", "trace.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(spans[0].name).toBe("http POST /orders");
    expect(spans[0].attributes["sim.now"]).toBe(120_000);
    expect(spans[0].scope).toBe("orders");
    const logs = readFileSync(join(dataDir, "logs", "orders.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(logs[0]).toMatchObject({ event: "placed", service: "orders", simNow: 120_000, orderId: "o1" });
    await provider.shutdown();
  });

  it("evaluates alert rules on the clock and logs event=alert", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sudsnik-otel-"));
    const clock = new SimClock();
    const t = createTelemetryProvider({ dataDir, clock }).forService("orders");
    const runner = await runAlerts({ dir: join(import.meta.dirname, "alerts"), clock, telemetry: t, cost: () => ({ service: "orders", sinceMs: 0, totalUnits: 0, byOperation: {}, byEndpoint: {} }) });
    expect(runner.rules.map((r) => r.name)).toEqual(["stuck_orders"]);
    clock.advanceTo(60_000);
    t.counter("orders.stuck").add();
    clock.advanceTo(120_000);
    runner.stop();
    clock.advanceTo(600_000);
    const alerts = readFileSync(join(dataDir, "logs", "orders.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.event === "alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].rule).toBe("stuck_orders");
    expect(runner.evaluateAll()).toEqual(["stuck_orders"]);
  });

  it("logs a repeating job's failure instead of letting it end the process", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sudsnik-otel-"));
    const clock = new SimClock();
    const t = createTelemetryProvider({ dataDir, clock }).forService("orders");
    everyGuarded(clock, 60_000, "reconcile", () => Promise.reject(new Error("the database connection is not open")), t.logger);
    everyGuarded(clock, 60_000, "sweep", () => {
      throw new Error("thrown, not rejected");
    }, t.logger);
    clock.advanceTo(60_000);
    await Promise.resolve();
    const records = readFileSync(join(dataDir, "logs", "orders.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { event: string; error: string });
    expect(records.map((r) => r.event)).toEqual(["sweep_failed", "reconcile_failed"]);
    expect(records[1]!.error).toBe("the database connection is not open");
  });
});
