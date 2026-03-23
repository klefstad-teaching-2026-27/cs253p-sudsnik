import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractSuite } from "@sudsnik/contracts/testing/contractSuite";
import { routes } from "@sudsnik/contracts/services/accounts";
import { createApp, handlersDir } from "../../src/index.js";

contractSuite(
  { describe, it, expect, beforeAll, afterAll },
  {
    service: "accounts",
    routes,
    createApp,
    handlersDir,
    examples: {
      operator: { params: { operatorId: "op1" } },
      updateOperator: { params: { operatorId: "op1" }, body: { name: "Aurora Orbital Services" } },
      habitat: { params: { habitatId: "hab01" } },
      crew: { params: { habitatId: "hab01" } },
    },
  },
);
