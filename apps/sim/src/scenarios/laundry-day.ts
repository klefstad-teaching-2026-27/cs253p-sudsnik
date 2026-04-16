import { ORDER_RATE, type Scenario } from "@sudsnik/contracts";
import { knownFaultsUrl, loadFaultSchedule } from "../faults/schedule.js";

export const scenario: Scenario = {
  name: "laundry-day",
  orbits: 8,
  ordersPerOrbit: (scale) => ORDER_RATE.baseline * scale,
  faults: loadFaultSchedule(knownFaultsUrl("laundry-day")),
  invariants: ["breaker_opens_on_429", "no_dropped_orders"],
  bands: ["p95", "units"],
  scaleFromOrbit: 2,
};
