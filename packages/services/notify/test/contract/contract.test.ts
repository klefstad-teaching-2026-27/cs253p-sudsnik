import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { routes } from "@sudsnik/contracts/services/notify";
import { contractSuite } from "@sudsnik/contracts/testing/contractSuite";
import { ok } from "@sudsnik/kernel";
import { createApp, handlersDir } from "../../src/index.js";

contractSuite(
  { describe, it, expect, beforeAll, afterAll },
  {
    service: "notify",
    routes,
    createApp,
    handlersDir,
    examples: {
      send: { body: { habitatId: "hab01", orderId: "o1", channel: "habitat-console", template: "order.placed", params: { orderId: "o1", podId: "hab01-p001" } } },
      digest: { params: { habitatId: "hab01" } },
    },
    prepare(deps) {
      deps.clients.relay.deliver = async () => ok({ deliveryId: "dlv-1" });
    },
  },
);
