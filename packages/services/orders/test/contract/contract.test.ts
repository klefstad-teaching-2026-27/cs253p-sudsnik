import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { routes } from "@sudsnik/contracts/services/orders";
import { contractSuite } from "@sudsnik/contracts/testing/contractSuite";
import { serviceDataFile } from "@sudsnik/infra-boot";
import { openDb } from "@sudsnik/infra-db";
import { OrderRepository } from "../../src/core/OrderRepository.js";
import { migrationsDir } from "../../src/core/paths.js";
import { createApp, handlersDir } from "../../src/index.js";

const SEEDED = "contract-order";

contractSuite(
  { describe, it, expect, beforeAll, afterAll },
  {
    service: "orders",
    routes,
    createApp,
    handlersDir,
    examples: {
      place: { body: { habitatId: "hab01", podId: "hab01-p001" } },
      cancel: { params: { orderId: SEEDED }, body: { reason: "contract sweep" } },
      get: { params: { orderId: SEEDED } },
    },
    // The sweep expects every route to answer non-404; cancel and get need an order that exists before createApp runs.
    prepare(deps) {
      const db = openDb({ path: serviceDataFile(deps), service: deps.service, meter: deps.meter, migrationsDir });
      new OrderRepository(db).insert({ orderId: SEEDED, tenantId: "op1", habitatId: "hab01", podId: "hab01-p002", state: "placed", payment: "pending", placedAt: 0, updatedAt: 0 });
      db.close();
    },
  },
);
