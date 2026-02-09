import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeEnvelope } from "@sudsnik/contracts";
import { SimClock, ok } from "@sudsnik/kernel";
import { describe, expect, it } from "vitest";
import { openBus } from "../src/bus.js";

const meter = { charge: () => undefined };

describe("late subscription", () => {
  it("delivers the messages a topic already had when its handler registered", async () => {
    const bus = openBus({ path: join(mkdtempSync(join(tmpdir(), "sudsnik-bus-")), "bus.sqlite"), clock: new SimClock(), meter });
    const sim = bus.forService("sim");
    await sim.publish(makeEnvelope({ topic: "order.placed", tenantId: "op1", occurredAt: 1, payload: { orderId: "o1", habitatId: "hab01", podId: "hab01-p001", requestedAt: 1 } }));
    await sim.publish(makeEnvelope({ topic: "wash.completed", tenantId: "op1", occurredAt: 2, payload: { orderId: "o1", washerId: "A1", completedAt: 2, cycleUnits: 10 } }));

    const orders = bus.forService("orders");
    const seen: string[] = [];
    // A service registers its handlers one at a time; a poll between two of them must not lose the rest.
    orders.subscribe("wash.completed", async (e) => { seen.push(e.topic); return ok(undefined); }, { consumer: "orders" });
    await bus.poll();
    orders.subscribe("order.placed", async (e) => { seen.push(e.topic); return ok(undefined); }, { consumer: "orders" });
    await bus.poll();
    bus.close();
    expect(seen).toEqual(["wash.completed", "order.placed"]);
  });
});
