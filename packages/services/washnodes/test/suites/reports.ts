import { describe, expect, it } from "vitest";
import { WASHERS_PER_NODE } from "@sudsnik/contracts";
import { harness, type Harness, type Variant } from "../helpers.js";


async function washed(h: Harness, node: string, orderId: string): Promise<string> {
  const { cycleId, washerId } = await h.wash(node, orderId);
  h.fw.complete(cycleId);
  await h.callback(h.fw.callbackFor(cycleId));
  return washerId;
}

/** The behaviour every variant of this seam owes, run once per variant a tree has. */
export function reportsSuite(variants: Variant[]): void {
  describe.each(variants)("$name anomaly reports", (variant) => {
    const flagged = [{ action: "quarantine" }, { action: "escalate" }] as const;
    const clear = [{ action: "clean" }, { action: "inspect" }] as const;

    it.each(flagged)("marks the washer that washed the pod maintenance on a $action triage and never holds it again", async ({ action }) => {
      const h = await harness(variant);
      const washerId = await washed(h, "B", "o1");
      await h.deliver("anomaly.reported", { reportId: "r1", podId: "hab01-p001", orderId: "o1", note: "grey residue" });
      await h.deliver("triage.completed", { reportId: "r1", orderId: "o1", podId: "hab01-p001", category: "contamination", severity: "high", action, tokens: 120 });
      expect((await h.status("B")).body.washers.find((w) => w.washerId === washerId)?.state).toBe("maintenance");
      const holds = [];
      for (let i = 0; i < WASHERS_PER_NODE; i++) holds.push(await h.acquire("B", `later-${i}`));
      const beforeLast = WASHERS_PER_NODE - 1;
      expect(holds.slice(0, beforeLast).map((r) => r.status)).toEqual(Array(beforeLast).fill(201));
      expect(holds.map((r) => r.body.washerId)).not.toContain(washerId);
      expect(holds.at(-1)!.status).toBe(429);
      await h.close();
    });

    it.each(clear)("leaves the washer in service on a $action triage", async ({ action }) => {
      const h = await harness(variant);
      const washerId = await washed(h, "C", "o1");
      await h.deliver("anomaly.reported", { reportId: "r1", podId: "hab01-p001", orderId: "o1", note: "faint smell" });
      await h.deliver("triage.completed", { reportId: "r1", orderId: "o1", podId: "hab01-p001", category: "odor", severity: "low", action, tokens: 80 });
      expect((await h.status("C")).body.washers.find((w) => w.washerId === washerId)?.state).toBe("idle");
      await h.close();
    });

    it("flags from the triage alone, on the order's latest washer, and a redelivered triage changes nothing more", async () => {
      const h = await harness(variant);
      await washed(h, "A", "o1");
      const washerId = await washed(h, "A", "o1");
      const triage = { reportId: "r1", orderId: "o1", podId: "hab01-p001", category: "damage", severity: "high", action: "escalate", tokens: 100 } as const;
      await h.deliver("triage.completed", triage);
      await h.deliver("triage.completed", triage);
      expect((await h.status("A")).body.washers.filter((w) => w.state === "maintenance").map((w) => w.washerId)).toEqual([washerId]);
      await h.close();
    });

    it("records a report for an order it never washed without failing the handler", async () => {
      const h = await harness(variant);
      const results = await h.deliver("anomaly.reported", { reportId: "r9", podId: "hab01-p009", orderId: "never-washed", note: "?" });
      expect(results).toEqual([{ ok: true, value: undefined }]);
      await h.deliver("triage.completed", { reportId: "r9", orderId: "never-washed", podId: "hab01-p009", category: "other", severity: "low", action: "quarantine", tokens: 10 });
      for (const node of ["A", "B", "C"]) expect((await h.status(node)).body.washers.every((w) => w.state === "idle")).toBe(true);
      await h.close();
    });
  });
}
