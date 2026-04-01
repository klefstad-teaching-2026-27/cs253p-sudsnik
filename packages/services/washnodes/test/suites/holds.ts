import { describe, expect, it } from "vitest";
import { HOLD_TTL_MS, WASHERS_PER_NODE } from "@sudsnik/contracts";
import { harness, type Variant } from "../helpers.js";


/** The behaviour every variant of this seam owes, run once per variant a tree has. */
export function holdsSuite(variants: Variant[]): void {
  describe.each(variants)("$name holds", (variant) => {
    const cases = [
      { node: "A", firmware: "v1", holdCall: "rpc.MachineHold:A1", startCall: "v1.start:A1", releaseCall: "v1.release:A1" },
      { node: "B", firmware: "v2", holdCall: "v2.createHold:B1", startCall: "v2.startCycle:h2-1@http://127.0.0.1:4003/callbacks", releaseCall: "v2.deleteHold:h2-1" },
    ];

    it.each(cases)("acquires at node $node through firmware $firmware, stores the hold held for one orbit, and publishes hold.acquired", async (c) => {
      const h = await harness(variant);
      await h.advance(60_000);
      const res = await h.acquire(c.node, "o1");
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ nodeId: c.node, orderId: "o1", tenantId: "op1", state: "held", version: 0, acquiredAt: 60_000, expiresAt: 60_000 + HOLD_TTL_MS });
      expect(h.fw.calls).toContain(c.holdCall);
      const acquired = await h.events("hold.acquired");
      expect(acquired).toHaveLength(1);
      expect(acquired[0]!.tenantId).toBe("op1");
      expect(acquired[0]!.payload).toEqual({ holdId: res.body.holdId, washerId: res.body.washerId, nodeId: c.node, orderId: "o1", expiresAt: res.body.expiresAt });
      const status = await h.status(c.node);
      expect(status.body.washers.find((w) => w.washerId === res.body.washerId)).toMatchObject({ state: "held", holdId: res.body.holdId });
      await h.close();
    });

    it.each(cases)("releases at node $node: frees the washer at the firmware and here, publishes hold.released, and is idempotent", async (c) => {
      const h = await harness(variant);
      const hold = (await h.acquire(c.node, "o1")).body;
      const released = await h.release(hold.holdId, "shuttle missed window");
      expect(released.status).toBe(200);
      expect(released.body).toMatchObject({ holdId: hold.holdId, state: "released", version: 1 });
      expect(h.fw.calls).toContain(c.releaseCall);
      expect((await h.events("hold.released")).map((e) => e.payload)).toEqual([{ holdId: hold.holdId, washerId: hold.washerId, orderId: "o1", reason: "shuttle missed window" }]);
      expect((await h.status(c.node)).body.washers.find((w) => w.washerId === hold.washerId)?.state).toBe("idle");
      const again = await h.release(hold.holdId, "again");
      expect(again.status).toBe(200);
      expect(await h.events("hold.released")).toHaveLength(1);
      await h.close();
    });

    it("answers 429 QUOTA, retryable, once every washer at the node is held", async () => {
      const h = await harness(variant);
      for (let i = 0; i < WASHERS_PER_NODE; i++) expect((await h.acquire("C", `o${i}`)).status).toBe(201);
      const full = await h.acquire("C", "one-too-many");
      expect(full.status).toBe(429);
      expect(full.body).toMatchObject({ code: "QUOTA", retryable: true });
      expect(await h.events("hold.acquired")).toHaveLength(WASHERS_PER_NODE);
      await h.close();
    });

    it("gives up the reservation when the firmware refuses the hold", async () => {
      const h = await harness(variant);
      h.fw.failNext("v2.createHold", { code: "CONFLICT", message: "washer B1 is already held or washing", retryable: false });
      expect((await h.acquire("B", "o1")).status).toBe(409);
      expect(await h.events("hold.acquired")).toHaveLength(0);
      expect((await h.status("B")).body.washers.every((w) => w.state === "idle")).toBe(true);
      const next = await h.acquire("B", "o2");
      expect(next.status).toBe(201);
      expect(next.body.washerId).toBe("B1");
      await h.close();
    });

    it("keeps one tenant's holds invisible to another", async () => {
      const h = await harness(variant);
      const hold = (await h.acquire("B", "o1", "op1")).body;
      expect((await h.release(hold.holdId, "x", "op2")).status).toBe(404);
      expect((await h.start(hold.holdId, "op2")).status).toBe(404);
      expect((await h.release(hold.holdId, "x", "op1")).status).toBe(200);
      await h.close();
    });

    it("replays a write with the same idempotency key without acquiring twice", async () => {
      const h = await harness(variant);
      const headers = { "x-sudsnik-tenant": "op1", "idempotency-key": "same-key" };
      const first = await h.app.inject({ method: "POST", url: "/holds", headers, payload: { nodeId: "B", orderId: "o1" } });
      const second = await h.app.inject({ method: "POST", url: "/holds", headers, payload: { nodeId: "B", orderId: "o1" } });
      expect(second.json()).toEqual(first.json());
      expect(second.headers["idempotent-replayed"]).toBe("true");
      expect(await h.events("hold.acquired")).toHaveLength(1);
      await h.close();
    });
  });
}
