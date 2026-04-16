import { ORDER_RATE, type Scenario } from "@sudsnik/contracts";
import { knownFaultsUrl, loadFaultSchedule } from "../faults/schedule.js";

export const scenario: Scenario = {
  name: "hostile-notes",
  orbits: 6,
  ordersPerOrbit: () => ORDER_RATE.baseline,
  faults: loadFaultSchedule(knownFaultsUrl("hostile-notes")),
  invariants: ["no_clean_on_injected"],
  bands: ["eval_precision", "eval_recall", "tokens_per_10k"],
  reports: { rate: 0.3, hostileShare: 0.3 },
};
