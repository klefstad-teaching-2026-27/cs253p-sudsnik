export const OPERATORS = ["op1", "op2", "op3", "op4"] as const;
export type OperatorId = (typeof OPERATORS)[number];

export const HABITATS = Array.from({ length: 12 }, (_, i) => `hab${String(i + 1).padStart(2, "0")}`);
export const HABITATS_PER_OPERATOR = 3;
export function operatorOfHabitat(habitatId: string): OperatorId {
  const index = HABITATS.indexOf(habitatId);
  if (index < 0) throw new RangeError(`unknown habitat ${habitatId}`);
  return OPERATORS[Math.floor(index / HABITATS_PER_OPERATOR)]!;
}

export const NODES = ["A", "B", "C"] as const;
export type NodeId = (typeof NODES)[number];
export const WASHERS_PER_NODE = 12;
export const NODE_FIRMWARE: Record<NodeId, "v1" | "v2"> = { A: "v1", B: "v2", C: "v2" };
export function washerId(node: NodeId, index: number): string {
  return `${node}${index + 1}`;
}

export const SHUTTLES = ["sh1", "sh2", "sh3", "sh4", "sh5", "sh6"] as const;
export const SHUTTLE_CAPACITY = 40;

export const PODS_PER_HABITAT = 200;
export const POD_FLEET = HABITATS.length * PODS_PER_HABITAT;
export function podId(habitatId: string, index: number): string {
  return `${habitatId}-p${String(index + 1).padStart(3, "0")}`;
}

export const MINUTE_MS = 60_000;
export const ORBIT_MINUTES = 90;
export const ORBIT_MS = ORBIT_MINUTES * MINUTE_MS;
export const LINK_WINDOW_MINUTES = 10;
export const LINK_WINDOW_PHASE_STEP_MINUTES = 7.5;
/** Orbit minute at which habitat index i (0 to 11) comes into contact. */
export function linkWindowStartMinute(habitatIndex: number): number {
  return habitatIndex * LINK_WINDOW_PHASE_STEP_MINUTES;
}
export function habitatIndex(habitatId: string): number {
  const i = HABITATS.indexOf(habitatId);
  if (i < 0) throw new RangeError(`unknown habitat ${habitatId}`);
  return i;
}
export function isHabitatVisible(habitatId: string, nowMs: number): boolean {
  const minuteInOrbit = (nowMs % ORBIT_MS) / MINUTE_MS;
  const start = linkWindowStartMinute(habitatIndex(habitatId));
  // The windows tile the orbit, so the last habitat's runs past the end of one orbit into the start of the next;
  // measuring from the start the long way round keeps every habitat's window LINK_WINDOW_MINUTES long.
  const sinceStart = (minuteInOrbit - start + ORBIT_MINUTES) % ORBIT_MINUTES;
  return sinceStart < LINK_WINDOW_MINUTES;
}
/** Start of the next window for a habitat at or after nowMs, in simulated ms. */
export function nextWindowStart(habitatId: string, nowMs: number): number {
  const start = linkWindowStartMinute(habitatIndex(habitatId)) * MINUTE_MS;
  const orbitStart = nowMs - (nowMs % ORBIT_MS);
  const candidate = orbitStart + start;
  return candidate >= nowMs ? candidate : candidate + ORBIT_MS;
}

export const TRANSIT_ORBITS_PER_LEG = 1;
export const WASH_CYCLE_MINUTES = 45;
export const WASH_CYCLE_MS = WASH_CYCLE_MINUTES * MINUTE_MS;
export const CYCLE_FAULT_RATE = { v1: 0.05, v2: 0.01 } as const;
export const CYCLE_ATTEMPTS_PER_ORDER = 3;
export const HOLD_TTL_MS = ORBIT_MS;

export const TURNAROUND_SLO = { orbits: 6, fraction: 0.95 } as const;
export const PLACEMENT_P95_MS = 300;
export const ORDER_RATE = { baseline: 40, peak: 200 } as const;
export const CLOCK_RATE = 600;
export const DRAIN_TAIL_ORBITS = 6;

export const OPS = [
  "CACHE_READ",
  "CACHE_WRITE",
  "DB_READ",
  "DB_LAZY_WRITE",
  "DB_WRITE",
  "QUEUE_PUBLISH",
  "INTERNAL_CALL",
  "EXTERNAL_CALL",
  "CONNECTION",
  "LLM_TOKEN",
] as const;
export type Op = (typeof OPS)[number];

export const UNIT_PRICES: Record<Op, number> = {
  CACHE_READ: 4,
  CACHE_WRITE: 6,
  DB_READ: 8,
  DB_LAZY_WRITE: 12,
  DB_WRITE: 15,
  QUEUE_PUBLISH: 10,
  INTERNAL_CALL: 64,
  EXTERNAL_CALL: 128,
  CONNECTION: 256,
  LLM_TOKEN: 0.05,
};
export const DOLLARS_PER_UNIT = 0.0001;

/** Base price of a wash, in minor units, by operator pricing tier; cycleUnits are added at CYCLE_UNIT_PRICE each. */
export const WASH_PRICE_MINOR: Record<"standard" | "priority", number> = { standard: 4_900, priority: 7_900 };
export const CYCLE_UNIT_PRICE_MINOR = 3;
/** What a quote prices before the washer has reported: above anything a washer reports, so an authorization has headroom. */
export const EXPECTED_CYCLE_UNITS = 120;
export const DEFAULT_CURRENCY = "USD";

export const CURRENCIES = ["USD", "EUR", "AUD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export function isCurrency(s: string): s is Currency {
  return (CURRENCIES as readonly string[]).includes(s);
}

/**
 * The fixed conversion table: native minor units per 10,000 USD minor units.
 * Integer basis points rather than a float rate, so a conversion is the same on every machine and every run.
 */
export const CURRENCY_RATE_BP: Record<Currency, number> = { USD: 10_000, EUR: 9_200, AUD: 15_200 };

/** USD minor units in `currency`'s own minor units, at `CURRENCY_RATE_BP`. */
export function toCurrency(usdMinor: number, currency: Currency): number {
  return Math.round((usdMinor * CURRENCY_RATE_BP[currency]) / 10_000);
}

export function toUsd(minor: number, currency: Currency): number {
  return Math.round((minor * 10_000) / CURRENCY_RATE_BP[currency]);
}

export const SUNSET_DATE = "Sat, 01 May 2027 00:00:00 GMT";
export const PUBLIC_SEED = "00000000c0ffee00";

export const SUPPORT_TOKEN_BUDGET_PER_ORBIT = 20_000;
