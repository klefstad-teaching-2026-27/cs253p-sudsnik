import type { CostResponse, ServiceDeps } from "@sudsnik/contracts";

interface CostingMeter {
  cost(service: string): CostResponse;
}

const hasCost = (meter: ServiceDeps["meter"]): meter is ServiceDeps["meter"] & CostingMeter => "cost" in meter && typeof meter.cost === "function";

/** The process sink splits cost by service; a plain meter (tests) has nothing to report. */
export const costOf = (deps: ServiceDeps): CostResponse =>
  hasCost(deps.meter) ? deps.meter.cost(deps.service) : { service: deps.service, sinceMs: 0, totalUnits: 0, byOperation: {}, byEndpoint: {} };
