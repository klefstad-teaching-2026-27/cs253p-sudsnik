import { describe, expect, it } from "vitest";
import { NODES, NODE_FIRMWARE, WASHERS_PER_NODE, washerId } from "@sudsnik/contracts";
import { harness, type Variant } from "../helpers.js";


/** The behaviour every variant of this seam owes, run once per variant a tree has. */
export function inventorySuite(variants: Variant[]): void {
  describe.each(variants)("$name inventory", (variant) => {
    it("seeds the canon fleet: every node, every washer, the node's firmware, all idle", async () => {
      const h = await harness(variant);
      for (const node of NODES) {
        const res = await h.status(node);
        expect(res.status).toBe(200);
        expect(res.body.inContact).toBe(true);
        expect(res.body.washers.map((w) => w.washerId)).toEqual(Array.from({ length: WASHERS_PER_NODE }, (_, i) => washerId(node, i)));
        expect(new Set(res.body.washers.map((w) => w.firmware))).toEqual(new Set([NODE_FIRMWARE[node]]));
        expect(res.body.washers.every((w) => w.state === "idle")).toBe(true);
      }
      await h.close();
    });

    it("answers 404 for a node that is not in canon", async () => {
      const h = await harness(variant);
      expect((await h.status("D")).status).toBe(404);
      expect((await h.acquire("D", "o1")).status).toBe(404);
      await h.close();
    });
  });
}
