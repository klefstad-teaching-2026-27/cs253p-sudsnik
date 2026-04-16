import { ORDER_RATE, type Scenario } from "@sudsnik/contracts";
import { knownFaultsUrl, loadFaultSchedule } from "../faults/schedule.js";

export const scenario: Scenario = {
  name: "storm",
  orbits: 12,
  ordersPerOrbit: () => ORDER_RATE.baseline,
  faults: loadFaultSchedule(knownFaultsUrl("storm")),
  invariants: ["false_green_absent", "no_stuck_orders"],
  bands: ["time_to_detect", "dead_letters"],
};
