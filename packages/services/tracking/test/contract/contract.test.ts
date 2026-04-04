import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractSuite } from "@sudsnik/contracts/testing/contractSuite";
import { routes } from "@sudsnik/contracts/services/tracking";
import { createApp, handlersDir } from "../../src/index.js";
import { openStore } from "../../src/store.js";
import { fakeEphemeris, positionCallback } from "../helpers.js";

contractSuite(
  { describe, it, expect, beforeAll, afterAll },
  {
    service: "tracking",
    routes,
    createApp,
    handlersDir,
    examples: {
      position: { params: { shuttleId: "sh1" } },
      positionCached: { params: { shuttleId: "sh1" } },
      podLocation: { params: { podId: "hab01-p001" } },
      relayCallback: { body: positionCallback("sh1", 0.5, 0) },
    },
    prepare(deps) {
      fakeEphemeris(deps);
      const store = openStore(deps);
      store.putPosition({ shuttleId: "sh1", orbitPhase: 0.1, observedAt: 0 });
      store.locate("op1", "o1", { podId: "hab01-p001", kind: "habitat", id: "hab01", since: 0 });
      store.close();
    },
  },
);
