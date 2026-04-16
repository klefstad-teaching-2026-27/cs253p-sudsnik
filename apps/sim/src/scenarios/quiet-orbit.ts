import { ORDER_RATE, type Scenario } from "@sudsnik/contracts";
import { knownFaultsUrl, loadFaultSchedule } from "../faults/schedule.js";

export const scenario: Scenario = {
  name: "quiet-orbit",
  orbits: 10,
  ordersPerOrbit: () => ORDER_RATE.baseline,
  faults: loadFaultSchedule(knownFaultsUrl("quiet-orbit")),
  invariants: ["no_stuck_orders", "cancelled_orders_compensated", "orders_settled"],
  bands: ["turnaround", "p95", "units"],
  cancels: { rate: 0.1 },
};
