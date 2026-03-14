import { describe, expect, it } from "vitest";
import { MOCKS, TENANT_HEADER } from "@sudsnik/contracts";
import { startAllMocks } from "../src/index.js";
import { SEED, tmpDir } from "./helpers.js";

describe("startAllMocks", () => {
  it("listens all seven on the given ports, wires callbacks to its own relay, and closes", async () => {
    const ports = Object.fromEntries(MOCKS.map((m) => [m, 0])) as Record<(typeof MOCKS)[number], number>;
    const running = await startAllMocks({ seed: SEED, dataDir: tmpDir(), ports, tenantKeys: { op1: "k1" } });
    try {
      expect(Object.keys(running.urls).sort()).toEqual([...MOCKS].sort());
      for (const name of MOCKS) {
        const res = await fetch(`${running.urls[name]}/_sim/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clockMs: 0, orbit: 0, dark: [], faults: [] }) });
        expect(res.status, name).toBe(200);
        const stats = await fetch(`${running.urls[name]}/_sim/stats`);
        expect(stats.status, name).toBe(200);
        expect(await stats.json(), name).toEqual({ quotaRefusals: { total: 0, byTenant: {} } });
      }
      const token = await fetch(`${running.urls.identity}/token`, { method: "POST", headers: { "content-type": "application/json", [TENANT_HEADER]: "op1" }, body: JSON.stringify({ operatorId: "op1", key: "k1" }) });
      expect(token.status).toBe(201);
      const bare = await fetch(`${running.urls.oracle}/usage`);
      expect(bare.status).toBe(400);
    } finally {
      await running.close();
    }
  });
});
