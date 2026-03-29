import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractSuite } from "@sudsnik/contracts/testing/contractSuite";
import type { FakeDeps } from "@sudsnik/contracts/testing";
import { routes } from "@sudsnik/contracts/services/dispatch";
import { createApp, handlersDir } from "../../src/index.js";
import { buildCallback, buildOrderPlaced, stubClients } from "../support/builders.js";

const ORDER = "ord-contract";

contractSuite(
  { describe, it, expect, beforeAll, afterAll },
  {
    service: "dispatch",
    routes,
    handlersDir,
    prepare: (deps) => void stubClients(deps),
    // The route sweep needs an order dispatch has heard of; it arrives the way it does in production, on the bus.
    createApp: async (deps) => {
      const app = await createApp(deps);
      await (deps as FakeDeps).bus.deliver(buildOrderPlaced({ orderId: ORDER }));
      return app;
    },
    examples: {
      schedulePickup: { body: { orderId: ORDER } },
      scheduleReturn: { body: { orderId: ORDER } },
      reassign: { params: { orderId: ORDER } },
      get: { params: { orderId: ORDER } },
      relayCallback: { body: buildCallback("collected", { orderId: ORDER, podId: "hab01-p001", shuttleId: "sh1" }) },
    },
  },
);
