import { describe, expect, it } from "vitest";
import { CYCLE_ATTEMPTS_PER_ORDER, MINUTE_MS, ORBIT_MS, WASHERS_PER_NODE } from "@sudsnik/contracts";
import { V1_POLL_MS } from "../../src/domain/cycle.js";
import { FAULT_COOLDOWN_MS } from "../../src/domain/washer.js";
import { harness, type Variant } from "../helpers.js";


/** The behaviour every variant of this seam owes, run once per variant a tree has. */
export function cyclesSuite(variants: Variant[]): void {
  describe.each(variants)("$name cycles", (variant) => {
    it("starts a cycle on pod.delivered: the hold is consumed, the washer washes, wash.started is published", async () => {
      const h = await harness(variant);
      const hold = (await h.acquire("B", "o1")).body;
      const results = await h.deliver("pod.delivered", { orderId: "o1", podId: "hab01-p001", nodeId: "B", holdId: hold.holdId, deliveredAt: h.deps.clock.now() });
      expect(results).toEqual([{ ok: true, value: undefined }]);
      expect(h.fw.calls.some((c) => c.startsWith("v2.startCycle:"))).toBe(true);
      expect((await h.events("wash.started")).map((e) => e.payload)).toEqual([{ orderId: "o1", washerId: hold.washerId, startedAt: 0 }]);
      expect((await h.status("B")).body.washers.find((w) => w.washerId === hold.washerId)?.state).toBe("washing");
      const again = await h.start(hold.holdId);
      expect(again.status).toBe(201);
      expect(await h.events("wash.started")).toHaveLength(1);
      await h.close();
    });

    it("completes a v2 cycle from its callback, deduplicating on the callback id", async () => {
      const h = await harness(variant);
      const { cycleId, washerId } = await h.wash("C", "o1");
      await h.advance(45 * MINUTE_MS);
      h.fw.complete(cycleId, 41);
      const body = h.fw.callbackFor(cycleId);
      expect((await h.callback(body)).body).toEqual({ accepted: true, duplicate: false });
      expect((await h.callback(body)).body).toEqual({ accepted: true, duplicate: true });
      expect((await h.callback({ ...body, id: "another-id" })).body).toEqual({ accepted: true, duplicate: false });
      expect((await h.events("wash.completed")).map((e) => e.payload)).toEqual([{ orderId: "o1", washerId, completedAt: body.atMs, cycleUnits: 41 }]);
      expect((await h.status("C")).body.washers.find((w) => w.washerId === washerId)?.state).toBe("idle");
      await h.close();
    });

    it("answers a callback for a cycle it does not know without accepting it", async () => {
      const h = await harness(variant);
      const res = await h.callback({ id: "cb-unknown", cycleId: "nope", washerId: "B1", state: "completed", cycleUnits: 3, atMs: 0 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ accepted: false, duplicate: false });
      expect(await h.events("wash.completed")).toHaveLength(0);
      await h.close();
    });

    it("polls a v1 cycle to completion every five minutes through the legacy status call", async () => {
      const h = await harness(variant);
      const { cycleId, washerId } = await h.wash("A", "o1");
      const polls = () => h.fw.calls.filter((c) => c === "rpc.MachineStatus:A1").length;
      await h.advance(V1_POLL_MS);
      expect(polls()).toBe(1);
      expect(await h.events("wash.completed")).toHaveLength(0);
      h.fw.complete(cycleId, 29);
      await h.advance(V1_POLL_MS);
      expect(polls()).toBe(2);
      expect((await h.events("wash.completed")).map((e) => e.payload)).toEqual([{ orderId: "o1", washerId, completedAt: 2 * V1_POLL_MS, cycleUnits: 29 }]);
      await h.advance(V1_POLL_MS);
      expect(polls()).toBe(2);
      await h.close();
    });

    it("marks a node out of contact when its poll times out and back in contact when it answers", async () => {
      const h = await harness(variant);
      await h.wash("A", "o1");
      h.fw.failNext("rpc.MachineStatus", { code: "TIMEOUT", message: "dark", retryable: true });
      await h.advance(V1_POLL_MS);
      expect((await h.status("A")).body.inContact).toBe(false);
      await h.advance(V1_POLL_MS);
      expect((await h.status("A")).body.inContact).toBe(true);
      await h.close();
    });

    it("reconciles a v2 cycle whose callback never came by reading it back from the firmware", async () => {
      const { everyMs, staleAfterMs } = variant.profile.reconcile;
      const dueAt = Math.ceil(Math.max(everyMs, staleAfterMs) / everyMs) * everyMs;
      const h = await harness(variant);
      const { cycleId, washerId } = await h.wash("B", "o1");
      h.fw.complete(cycleId, 33);
      const reads = () => h.fw.calls.filter((c) => c === `v2.cycle:${cycleId}`).length;
      await h.advance(dueAt - MINUTE_MS);
      expect(reads()).toBe(0);
      await h.advance(MINUTE_MS);
      expect(reads()).toBe(1);
      expect((await h.events("wash.completed")).map((e) => e.payload)).toEqual([{ orderId: "o1", washerId, completedAt: dueAt, cycleUnits: 33 }]);
      await h.close();
    });

    it("retries a faulted cycle on another idle washer, then reports the fault final on the third attempt", async () => {
      const h = await harness(variant);
      const washersUsed: string[] = [];
      let { cycleId, washerId } = await h.wash("B", "o1");
      const podId = "pod-of-o1";
      for (let attempt = 1; attempt <= CYCLE_ATTEMPTS_PER_ORDER; attempt++) {
        washersUsed.push(washerId);
        h.fw.fault(cycleId, "E23_WATER_LOW");
        await h.callback(h.fw.callbackFor(cycleId));
        const faults = (await h.events("wash.faulted")).map((e) => e.payload);
        expect(faults.at(-1)).toEqual({ orderId: "o1", podId, washerId, faultCode: "E23_WATER_LOW", attempt, final: attempt === CYCLE_ATTEMPTS_PER_ORDER });
        if (attempt === CYCLE_ATTEMPTS_PER_ORDER) break;
        cycleId = h.fw.lastCycleId();
        washerId = h.fw.cycles.get(cycleId)!.washerId;
      }
      expect(new Set(washersUsed).size).toBe(CYCLE_ATTEMPTS_PER_ORDER);
      expect(await h.events("wash.started")).toHaveLength(CYCLE_ATTEMPTS_PER_ORDER);
      expect(await h.events("hold.acquired")).toHaveLength(CYCLE_ATTEMPTS_PER_ORDER);
      const states = (await h.status("B")).body.washers.filter((w) => washersUsed.includes(w.washerId)).map((w) => w.state);
      expect(states).toEqual(["faulted", "faulted", "faulted"]);
      await h.advance(FAULT_COOLDOWN_MS);
      expect((await h.status("B")).body.washers.every((w) => w.state === "idle")).toBe(true);
      await h.close();
    });

    it("waits for the next sweep to retry when no washer at the node is idle", async () => {
      const h = await harness(variant);
      const others = [];
      for (let i = 0; i < WASHERS_PER_NODE - 1; i++) others.push((await h.acquire("C", `other-${i}`)).body);
      const { cycleId } = await h.wash("C", "o1");
      h.fw.fault(cycleId);
      await h.callback(h.fw.callbackFor(cycleId));
      expect(await h.events("wash.started")).toHaveLength(1);
      await h.release(others[0]!.holdId, "make room");
      await h.advance(MINUTE_MS);
      expect(await h.events("wash.started")).toHaveLength(2);
      expect((await h.events("wash.faulted")).map((e) => e.payload.final)).toEqual([false]);
      await h.close();
    });
  });
}
