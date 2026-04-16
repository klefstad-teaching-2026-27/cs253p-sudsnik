import { MINUTE_MS, ORBIT_MS, SHUTTLES, makeEnvelope, nextWindowStart, type Envelope } from "@sudsnik/contracts";
import { RelayCallback, type DeliverRequest } from "@sudsnik/contracts/mocks/relay";
import { describe, expect, it } from "vitest";
import { checksumVerifies } from "../src/checksum.js";
import { createWorld } from "../src/world.js";

const URLS = { dispatch: "http://dispatch.test", tracking: "http://tracking.test" };

function ev(topic: Envelope["topic"], payload: unknown, occurredAt = 0): Envelope {
  return makeEnvelope({ topic, tenantId: "op1", occurredAt, payload });
}

function setup(accept: (req: DeliverRequest) => boolean = () => true) {
  const delivered: DeliverRequest[] = [];
  const world = createWorld({
    deliver: async (req) => {
      const ok = accept(req);
      if (ok) delivered.push(req);
      return ok;
    },
    urls: URLS,
  });
  const kinds = () => delivered.map((d) => d.body.kind);
  return { world, delivered, kinds };
}

const placedHab01 = () => ev("order.placed", { orderId: "o1", habitatId: "hab01", podId: "hab01-p001", requestedAt: 0 });
const pickupHab01 = () => ev("pickup.scheduled", { orderId: "o1", podId: "hab01-p001", habitatId: "hab01", nodeId: "A", shuttleId: "sh1", windowStart: 0, windowEnd: 10 * MINUTE_MS });
const holdA = () => ev("hold.acquired", { holdId: "h1", washerId: "A1", nodeId: "A", orderId: "o1", expiresAt: ORBIT_MS });

describe("world", () => {
  it("collects at windowStart when the habitat is visible and delivers to the hold's node one orbit later", async () => {
    const { world, delivered, kinds } = setup();
    world.observe([placedHab01(), pickupHab01(), holdA()]);
    await world.step(0, []);
    const collected = delivered.filter((d) => d.body.kind === "collected");
    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({ origin: { kind: "habitat", id: "hab01" }, destination: { kind: "ground", id: "dispatch" }, to: URLS.dispatch, path: "/callbacks/relay", deliverAtMs: 0 });
    expect(RelayCallback.parse(collected[0]!.body)).toMatchObject({ kind: "collected", orderId: "o1", podId: "hab01-p001", shuttleId: "sh1" });
    expect(checksumVerifies(collected[0]!.body)).toBe(true);
    expect(kinds().filter((k) => k === "position")).toHaveLength(SHUTTLES.length);

    for (let t = MINUTE_MS; t < ORBIT_MS; t += MINUTE_MS) await world.step(t, []);
    expect(kinds().filter((k) => k === "delivered")).toHaveLength(0);
    await world.step(ORBIT_MS, []);
    const del = delivered.filter((d) => d.body.kind === "delivered");
    expect(del).toHaveLength(1);
    expect(del[0]!.body).toMatchObject({ orderId: "o1", podId: "hab01-p001", shuttleId: "sh1", nodeId: "A" });
    expect(del[0]!.origin).toEqual({ kind: "shuttle", id: "sh1" });
    expect(world.snapshot().pods["hab01-p001"]).toEqual({ kind: "node", id: "A" });
  });

  it("collects nothing for an order cancelled before its pickup: the crew keeps the pod", async () => {
    const { world, kinds } = setup();
    world.observe([placedHab01(), pickupHab01(), ev("order.cancelled", { orderId: "o1", reason: "x", origin: "customer", compensations: [] }, MINUTE_MS)]);
    await world.step(0, []);
    await world.step(MINUTE_MS, []);
    expect(kinds().filter((k) => k === "collected")).toHaveLength(0);
    expect(world.snapshot().pods["hab01-p001"] ?? { kind: "habitat", id: "hab01" }).toEqual({ kind: "habitat", id: "hab01" });
  });

  it("delivers to the node named in pickup.scheduled, with or without a hold, and learns pod and habitat from it", async () => {
    const { world, delivered } = setup();
    world.observe([ev("pickup.scheduled", { orderId: "o9", podId: "hab01-p009", habitatId: "hab01", nodeId: "B", shuttleId: "sh1", windowStart: 0, windowEnd: 10 * MINUTE_MS })]);
    await world.step(0, []);
    await world.step(ORBIT_MS, []);
    expect(delivered.find((d) => d.body.kind === "delivered")!.body).toMatchObject({ orderId: "o9", podId: "hab01-p009", nodeId: "B" });
    expect(world.snapshot().pods["hab01-p009"]).toEqual({ kind: "node", id: "B" });
    expect(world.snapshot().notes.pickupsWithoutNode).toBe(0);
  });

  it("does not collect while the habitat is out of its window or under a dark fault, and misses after windowEnd", async () => {
    const { world, kinds } = setup();
    world.observe([placedHab01(), pickupHab01(), holdA()]);
    await world.step(0, ["hab01"]);
    expect(kinds()).not.toContain("collected");
    await world.step(11 * MINUTE_MS, []);
    expect(kinds()).not.toContain("collected");
    expect(world.snapshot().notes.missedPickups).toBe(1);

    const late = setup();
    late.world.observe([placedHab01(), ev("pickup.scheduled", { orderId: "o1", podId: "hab01-p001", habitatId: "hab01", nodeId: "A", shuttleId: "sh1", windowStart: 20 * MINUTE_MS, windowEnd: 30 * MINUTE_MS })]);
    await late.world.step(20 * MINUTE_MS, []);
    expect(late.kinds()).not.toContain("collected");
    expect(late.world.snapshot().pendingPickups).toBe(1);
  });

  it("departs the node at windowStart when it is in contact and returns at the habitat's next window one orbit later", async () => {
    const { world, delivered, kinds } = setup();
    world.observe([placedHab01(), pickupHab01(), holdA()]);
    await world.step(0, []);
    await world.step(ORBIT_MS, []);
    const windowStart = ORBIT_MS + 30 * MINUTE_MS;
    world.observe([ev("return.scheduled", { orderId: "o1", podId: "hab01-p001", habitatId: "hab01", nodeId: "A", shuttleId: "sh2", windowStart, windowEnd: windowStart + 10 * MINUTE_MS }, ORBIT_MS)]);
    await world.step(windowStart, ["A"]);
    expect(world.snapshot().pods["hab01-p001"]).toEqual({ kind: "node", id: "A" });
    await world.step(windowStart + MINUTE_MS, []);
    expect(world.snapshot().pods["hab01-p001"]).toEqual({ kind: "shuttle", id: "sh2" });
    const arrival = nextWindowStart("hab01", windowStart + MINUTE_MS + ORBIT_MS);
    await world.step(arrival - MINUTE_MS, []);
    expect(kinds()).not.toContain("returned");
    await world.step(arrival, []);
    const returned = delivered.filter((d) => d.body.kind === "returned");
    expect(returned).toHaveLength(1);
    expect(returned[0]!.body).toMatchObject({ orderId: "o1", podId: "hab01-p001", shuttleId: "sh2" });
    expect(world.snapshot().pods["hab01-p001"]).toEqual({ kind: "habitat", id: "hab01" });
  });

  it("retries a refused delivery on the next step and counts malformed events", async () => {
    let refuse = true;
    const { world, kinds } = setup(() => !refuse);
    world.observe([placedHab01(), pickupHab01(), holdA(), ev("hold.acquired", { bad: true })]);
    await world.step(0, []);
    expect(kinds()).toHaveLength(0);
    expect(world.snapshot().pendingDeliveries).toBe(1 + SHUTTLES.length);
    expect(world.snapshot().notes.deliveryRetries).toBe(1 + SHUTTLES.length);
    refuse = false;
    await world.step(MINUTE_MS, []);
    expect(kinds()).toContain("collected");
    expect(world.snapshot().pendingDeliveries).toBe(0);
    expect(world.snapshot().malformedEvents).toEqual({ "hold.acquired": 1 });
  });

  it("reports every shuttle's position every five minutes with a phase in [0, 1)", async () => {
    const { world, delivered } = setup();
    await world.step(5 * MINUTE_MS, []);
    await world.step(6 * MINUTE_MS, []);
    const positions = delivered.filter((d) => d.body.kind === "position");
    expect(positions).toHaveLength(SHUTTLES.length);
    for (const p of positions) {
      expect(p.destination).toEqual({ kind: "ground", id: "tracking" });
      expect(p.to).toBe(URLS.tracking);
      const phase = p.body.orbitPhase as number;
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(1);
    }
  });
});
