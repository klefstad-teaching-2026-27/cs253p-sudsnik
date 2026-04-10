import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { routes } from "@sudsnik/contracts/services/support";
import { type AnomalyReported } from "@sudsnik/contracts/events";
import { contractSuite } from "@sudsnik/contracts/testing/contractSuite";
import type { FakeDeps } from "@sudsnik/contracts/testing";
import { ok } from "@sudsnik/kernel";
import { createApp, handlersDir } from "../../src/index.js";

let deps: FakeDeps | undefined;

/** The sweep posts a report first; the id routes then address that report, read back from what it published. */
const latestReport: Record<string, string> = {
  get reportId() {
    return deps?.bus.ofTopic<AnomalyReported>("anomaly.reported").at(-1)?.payload.reportId ?? "missing";
  },
};

contractSuite(
  { describe, it, expect, beforeAll, afterAll },
  {
    service: "support",
    routes,
    createApp,
    handlersDir,
    examples: {
      report: { body: { orderId: "ord1", podId: "hab01-p001", note: "Pod smells faintly of sweat after the last cycle; bag intact, no stains." } },
      get: { params: latestReport },
      triage: { params: latestReport },
      escalate: { params: latestReport },
    },
    prepare(d) {
      deps = d;
      d.clients.oracle.complete = async () => ok({ completion: '{"category":"odor","severity":"low","action":"clean"}', promptTokens: 60, completionTokens: 1 });
    },
  },
);
