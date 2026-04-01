import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDEMPOTENCY_HEADER, TENANT_HEADER } from "@sudsnik/contracts";
import { routes } from "@sudsnik/contracts/services/washnodes";
import { contractSuite } from "@sudsnik/contracts/testing/contractSuite";
import type { FakeDeps } from "@sudsnik/contracts/testing";
import { createApp, handlersDir } from "../../src/index.js";
import { fakeFirmware } from "../helpers.js";

/** Route params are filled after the app exists: two holds at node B, one to release and one to start. */
const examples = {
  acquireHold: { body: { nodeId: "B", orderId: "contract-order" } },
  releaseHold: { params: { holdId: "unset" } },
  startCycle: { params: { holdId: "unset" } },
  status: { params: { nodeId: "A" } },
  washerCallback: { body: { id: "contract-callback", cycleId: "no-such-cycle", washerId: "B1", state: "completed", cycleUnits: 1, atMs: 0 } },
};

contractSuite(
  { describe, it, expect, beforeAll, afterAll },
  {
    service: "washnodes",
    routes,
    handlersDir,
    examples,
    prepare: (deps) => void fakeFirmware(deps),
    createApp: async (deps) => {
      const app = await createApp(deps as FakeDeps, { v1Rpc: fakeFirmware(deps as FakeDeps).rpc });
      for (const name of ["releaseHold", "startCycle"] as const) {
        const res = await app.inject({ method: "POST", url: "/holds", headers: { [TENANT_HEADER]: "op1", [IDEMPOTENCY_HEADER]: `seed-${name}` }, payload: { nodeId: "B", orderId: `seed-${name}` } });
        examples[name].params.holdId = (res.json() as { holdId: string }).holdId;
      }
      return app;
    },
  },
);
