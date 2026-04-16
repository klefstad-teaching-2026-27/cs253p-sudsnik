import { ORDER_RATE, type Scenario } from "@sudsnik/contracts";
import { knownFaultsUrl, loadFaultSchedule } from "../faults/schedule.js";

export const scenario: Scenario = {
  name: "dark-side",
  orbits: 12,
  // Scale fills the nodes: two arrivals contending for a node's last idle washer is what the week's race needs.
  ordersPerOrbit: (scale) => ORDER_RATE.baseline * scale,
  faults: loadFaultSchedule(knownFaultsUrl("dark-side")),
  invariants: ["no_double_launch", "no_launch_on_expired_hold", "reconciliation_completes", "no_forgotten_holds"],
  // Run at scale 2 it is overloaded by design, like laundry-day: the turnaround SLO is not the submission's.
  bands: [],
  // Between the two dark windows: what a store kept only in memory has forgotten by then is every hold in flight.
  // A hold is taken when the pod arrives and consumed when its cycle starts (system-spec §9.4), so few are in
  // flight at any instant and `no_forgotten_holds` catches the ones the restart lost; the gate's durability suite
  // is what grades the store, and this is what shows it in production.
  restartAtOrbit: 6,
};
