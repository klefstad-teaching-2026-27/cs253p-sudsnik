import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeEnvelope, PUBLIC_SEED } from "@sudsnik/contracts";
import { FakeMeter, fakeDeps } from "@sudsnik/contracts/testing";
import { openDb } from "@sudsnik/infra-db";
import { SimClock, err, ok, sudsnikError } from "@sudsnik/kernel";
import { MAX_DELIVERIES, VISIBILITY_TIMEOUT_MS, createOutbox, openBus, registerHandlers } from "../src/index.js";

const tmp = () => mkdtempSync(join(tmpdir(), "sudsnik-bus-"));
const placed = (n: number) => makeEnvelope({ topic: "order.placed", tenantId: "op1", occurredAt: n, payload: { orderId: `o${n}`, habitatId: "hab01", podId: "p", requestedAt: n } });

describe("bus", () => {
  it("delivers to each consumer once, records topic use, and meters publishes", async () => {
    const clock = new SimClock();
    const meter = new FakeMeter();
    const conn = openBus({ path: join(tmp(), "bus.sqlite"), clock, meter });
    const got: Record<string, string[]> = { dispatch: [], notify: [] };
    conn.forService("dispatch").subscribe("order.placed", async (e) => (got.dispatch!.push(e.id), ok(undefined)), { consumer: "dispatch" });
    conn.forService("notify").subscribe("order.placed", async (e) => (got.notify!.push(e.id), ok(undefined)), { consumer: "notify" });
    const e1 = placed(1);
    await conn.forService("orders").publish(e1);
    await conn.forService("orders").publish(e1);
    await conn.forService("orders").publish(placed(2));
    await conn.poll();
    await conn.poll();
    expect(got.dispatch).toHaveLength(2);
    expect(got.notify).toHaveLength(2);
    expect(meter.byOperation.QUEUE_PUBLISH?.count).toBe(3);
    const use = conn.topicUse();
    expect(use.find((u) => u.service === "orders" && u.direction === "publish")?.count).toBe(3);
    expect(use.find((u) => u.service === "dispatch" && u.direction === "consume")?.count).toBe(2);
    expect(conn.readAll("order.placed").map((m) => m.publisher)).toEqual(["orders", "orders"]);
    conn.close();
  });

  it("retries after the visibility timeout and dead-letters after MAX_DELIVERIES", async () => {
    const clock = new SimClock();
    const conn = openBus({ path: join(tmp(), "bus.sqlite"), clock, meter: new FakeMeter() });
    let attempts = 0;
    conn.forService("billing").subscribe("order.placed", async () => (attempts++, err(sudsnikError("UNAVAILABLE", "down"))), { consumer: "billing" });
    await conn.forService("orders").publish(placed(1));
    await conn.poll();
    await conn.poll();
    expect(attempts).toBe(1);
    for (let i = 1; i < MAX_DELIVERIES; i++) {
      clock.advanceTo(i * VISIBILITY_TIMEOUT_MS);
      await conn.poll();
    }
    expect(attempts).toBe(MAX_DELIVERIES);
    expect(conn.deadLetters("billing")).toHaveLength(1);
    clock.advanceTo(10 * VISIBILITY_TIMEOUT_MS);
    await conn.poll();
    expect(attempts).toBe(MAX_DELIVERIES);
    conn.close();
  });

  it("advances the clock from clock.tick and shares the file across connections", async () => {
    const path = join(tmp(), "bus.sqlite");
    const a = openBus({ path, clock: new SimClock(), meter: new FakeMeter() });
    const clockB = new SimClock();
    const b = openBus({ path, clock: clockB, meter: new FakeMeter() });
    await a.forService("sim").publish(makeEnvelope({ topic: "clock.tick", occurredAt: 60_000, payload: { nowMs: 60_000, orbit: 0, orbitPhase: 1 / 90 } }));
    await b.poll();
    expect(clockB.now()).toBe(60_000);
    expect(b.latestTick()?.orbit).toBe(0);
    a.close();
    b.close();
  });

  it("delivers to one consumer in publication order across every topic it subscribes to", async () => {
    const clock = new SimClock();
    const conn = openBus({ path: join(tmp(), "bus.sqlite"), clock, meter: new FakeMeter() });
    const seen: string[] = [];
    const orders = conn.forService("orders");
    for (const topic of ["wash.completed", "return.scheduled"] as const) {
      orders.subscribe(topic, async (e) => (seen.push(e.topic), ok(undefined)), { consumer: "orders" });
    }
    const washnodes = conn.forService("washnodes");
    await washnodes.publish(makeEnvelope({ topic: "wash.completed", tenantId: "op1", occurredAt: 1, payload: { orderId: "o1", washerId: "A1", completedAt: 1, cycleUnits: 100 } }));
    await conn.forService("dispatch").publish(
      makeEnvelope({ topic: "return.scheduled", tenantId: "op1", occurredAt: 1, payload: { orderId: "o1", podId: "hab01-p001", habitatId: "hab01", nodeId: "A", shuttleId: "sh1", windowStart: 1, windowEnd: 2 } }),
    );
    await conn.poll();
    expect(seen).toEqual(["wash.completed", "return.scheduled"]);
    conn.close();
  });

  it("rejects an invalid envelope", async () => {
    const conn = openBus({ path: join(tmp(), "bus.sqlite"), clock: new SimClock(), meter: new FakeMeter() });
    await expect(conn.forService("x").publish({ ...placed(1), id: "not-a-ulid" })).rejects.toThrow();
    conn.close();
  });
});

describe("outbox", () => {
  it("publishes rows in order once and reports pending", async () => {
    const dir = tmp();
    const clock = new SimClock();
    const conn = openBus({ path: join(dir, "bus.sqlite"), clock, meter: new FakeMeter() });
    const db = openDb({ path: join(dir, "orders.sqlite"), service: "orders", meter: new FakeMeter() });
    const outbox = createOutbox(db, conn.forService("orders"));
    db.transaction(() => {
      outbox.enqueue(placed(1));
      outbox.enqueue(placed(2));
    });
    expect(outbox.pending()).toBe(2);
    expect(await outbox.pump()).toBe(2);
    expect(await outbox.pump()).toBe(0);
    expect(conn.readAll("order.placed").map((m) => m.occurredAt)).toEqual([1, 2]);
    await outbox.stop();
    conn.close();
    db.close();
  });
});

describe("registry", () => {
  it("subscribes default-exported handlers from a directory and refuses undeclared topics", async () => {
    const deps = fakeDeps(PUBLIC_SEED, "dispatch", { handlersDir: join(import.meta.dirname, "handlers") });
    const regs = await registerHandlers(deps);
    expect(regs.map((r) => r.topic)).toEqual(["order.placed"]);
    const results = await deps.bus.deliver(placed(7));
    expect(results.every((r) => r.ok)).toBe(true);
    const bad = fakeDeps(PUBLIC_SEED, "accounts", { handlersDir: join(import.meta.dirname, "handlers") });
    await expect(registerHandlers(bad)).rejects.toThrow(/does not consume/);
  });
});
