import type { CostResponse, ServiceDeps } from "@sudsnik/contracts";
import type { MeterSink } from "@sudsnik/infra-metering";

/** The service's own cost when the meter is the process sink; an empty response under a plain Meter. */
export function costOf(deps: ServiceDeps): CostResponse {
  if ("cost" in deps.meter) return (deps.meter as MeterSink).cost(deps.service);
  return { service: deps.service, sinceMs: 0, totalUnits: 0, byOperation: {}, byEndpoint: {} };
}
