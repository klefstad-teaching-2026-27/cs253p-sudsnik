import { ORDER_RATE, type Scenario } from "@sudsnik/contracts";
import { knownFaultsUrl, loadFaultSchedule } from "../faults/schedule.js";

export const scenario: Scenario = {
  name: "migration",
  orbits: 8,
  ordersPerOrbit: () => ORDER_RATE.baseline,
  faults: loadFaultSchedule(knownFaultsUrl("migration")),
  invariants: ["both_client_sets_complete", "deprecation_header_on_v1"],
  bands: [],
  v2Share: 0.5,
  flags: ["api.v2"],
};
