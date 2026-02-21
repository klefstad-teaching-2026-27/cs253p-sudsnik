import { AsyncLocalStorage } from "node:async_hooks";
import { UNIT_PRICES, type CostEntry, type CostResponse, type Meter, type Op } from "@sudsnik/contracts";

const endpointContext = new AsyncLocalStorage<{ endpoint: string }>();

/** Runs fn with every charge that names no endpoint attributed to this one. */
export function runWithEndpoint<T>(endpoint: string, fn: () => T): T {
  return endpointContext.run({ endpoint }, fn);
}

/** Enters the endpoint context for the rest of the current async chain (Fastify hooks). */
export function enterEndpoint(endpoint: string): void {
  endpointContext.enterWith({ endpoint });
}

export function currentEndpoint(): string | undefined {
  return endpointContext.getStore()?.endpoint;
}

export interface MeterSink extends Meter {
  cost(service: string): CostResponse;
  services(): string[];
  reset(): void;
}

/** One sink per process; in --single every mounted service shares it and /cost splits by service tag. */
export function createMeterSink(sinceMs = 0): MeterSink {
  const byService = new Map<string, { byOperation: Record<string, CostEntry>; byEndpoint: Record<string, CostEntry>; total: number }>();
  const bucket = (service: string) => {
    let b = byService.get(service);
    if (!b) {
      b = { byOperation: {}, byEndpoint: {}, total: 0 };
      byService.set(service, b);
    }
    return b;
  };
  return {
    charge(op: Op, count: number, tags: { service: string; endpoint?: string }) {
      if (!(op in UNIT_PRICES)) throw new RangeError(`unknown op ${op}`);
      if (!Number.isFinite(count) || count < 0) throw new RangeError(`bad count ${count}`);
      const units = UNIT_PRICES[op] * count;
      const b = bucket(tags.service);
      const o = (b.byOperation[op] ??= { count: 0, units: 0 });
      o.count += count;
      o.units += units;
      const endpoint = tags.endpoint ?? currentEndpoint();
      if (endpoint) {
        const e = (b.byEndpoint[endpoint] ??= { count: 0, units: 0 });
        e.count += count;
        e.units += units;
      }
      b.total += units;
    },
    cost(service) {
      const b = bucket(service);
      return {
        service,
        sinceMs,
        totalUnits: round(b.total),
        byOperation: Object.fromEntries(Object.entries(b.byOperation).map(([k, v]) => [k, { count: v.count, units: round(v.units) }])),
        byEndpoint: Object.fromEntries(Object.entries(b.byEndpoint).map(([k, v]) => [k, { count: v.count, units: round(v.units) }])),
      };
    },
    services: () => [...byService.keys()],
    reset: () => byService.clear(),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A meter bound to one service and, optionally, one endpoint; what a request handler receives. */
export function scopedMeter(sink: Meter, service: string, endpoint?: string): Meter {
  return { charge: (op, count, tags) => sink.charge(op, count, { service, endpoint: tags.endpoint ?? endpoint }) };
}

export function unitsPer10k(costs: CostResponse[], ordersPlaced: number): number {
  if (ordersPlaced === 0) return 0;
  const total = costs.reduce((a, c) => a + c.totalUnits, 0);
  return Math.round((total * 10_000) / ordersPlaced);
}
