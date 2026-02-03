import { z } from "zod";
import { IdSchema, SimMsSchema } from "./common.js";
import type { FlagName } from "./flags.js";

export const MOCKS = ["payments", "ephemeris", "identity", "washer-v1", "washer-v2", "relay", "oracle"] as const;
export type MockName = (typeof MOCKS)[number];

export const SCENARIOS = ["quiet-orbit", "dark-side", "laundry-day", "storm", "hostile-notes", "migration"] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

export const FAULT_KINDS = {
  payments: ["timeout-rate", "duplicate-webhook-rate"],
  ephemeris: ["quota"],
  identity: ["error-burst"],
  "washer-v1": ["cycle-fault-rate"],
  "washer-v2": ["cycle-fault-rate"],
  relay: ["duplicate-rate", "reorder-rate", "bitflip-rate", "dark"],
  oracle: [],
} as const satisfies Record<MockName, readonly string[]>;
export type FaultKind = (typeof FAULT_KINDS)[MockName][number];

export const FaultEventSchema = z.object({
  atOrbit: z.number().int().nonnegative(),
  orbits: z.number().int().positive().optional(),
  mock: z.enum(MOCKS),
  kind: z.string(),
  params: z.record(z.string(), z.unknown()),
});
export type FaultEvent = z.infer<typeof FaultEventSchema>;

export const FaultScheduleSchema = z.object({ events: z.array(FaultEventSchema) });
export type FaultSchedule = z.infer<typeof FaultScheduleSchema>;

export const INVARIANT_IDS = [
  "lost_on_drain",
  "tenant_leak",
  "undeclared_topic",
  "no_double_launch",
  "no_launch_on_expired_hold",
  "reconciliation_completes",
  "no_forgotten_holds",
  "breaker_opens_on_429",
  "no_dropped_orders",
  "no_stuck_orders",
  "false_green_absent",
  "no_clean_on_injected",
  "both_client_sets_complete",
  "deprecation_header_on_v1",
  "cancelled_orders_compensated",
  "orders_settled",
] as const;
export type InvariantId = (typeof INVARIANT_IDS)[number];

export const BAND_IDS = ["turnaround", "p95", "units", "time_to_detect", "dead_letters", "eval_precision", "eval_recall", "tokens_per_10k"] as const;
export type BandId = (typeof BAND_IDS)[number];

export interface Scenario {
  name: ScenarioName;
  orbits: number;
  ordersPerOrbit: (scale: number) => number;
  /** Orbit from which ordersPerOrbit applies at scale; before it, the baseline rate. */
  scaleFromOrbit?: number;
  faults: FaultSchedule;
  invariants: InvariantId[];
  bands: BandId[];
  /** Share of returned orders that receive an anomaly report, and of those, the share drawn from the hostile set. */
  reports?: { rate: number; hostileShare: number };
  /** Share of driver clients calling /v2 instead of /v1. */
  v2Share?: number;
  /** Share of placed orders the driver cancels, half within minutes of placement and half an orbit and a half later. */
  cancels?: { rate: number };
  /** Orbit at whose start the stack is stopped with SIGTERM and started again on the same data directory. */
  restartAtOrbit?: number;
  /** Flags the scenario needs on; the driver adds them to the stack's environment when it boots one. */
  flags?: FlagName[];
}

/** Body of POST /_sim/state, sent to every mock once per simulated minute. */
export const SimStateSchema = z.object({
  clockMs: SimMsSchema,
  orbit: z.number().int().nonnegative(),
  dark: z.array(IdSchema),
  faults: z.array(FaultEventSchema),
});
export type SimState = z.infer<typeof SimStateSchema>;

export const ClockTickSchema = z.object({
  nowMs: SimMsSchema,
  orbit: z.number().int().nonnegative(),
  orbitPhase: z.number().min(0).lt(1),
});
export type ClockTick = z.infer<typeof ClockTickSchema>;

export const OracleJsonSchema = z.object({
  invariants: z.record(z.string(), z.object({ pass: z.boolean(), detail: z.string() })),
  bands: z.record(z.string(), z.number()),
  faults: z.array(FaultEventSchema),
  /** Every order without a state change for 3 orbits at the end of the run, with the orbit it last moved in. */
  stuckOrders: z.array(z.object({ orderId: z.string(), state: z.string(), sinceOrbit: z.number().int().nonnegative() })),
  ordersPlaced: z.number().int().nonnegative(),
  ordersReturned: z.number().int().nonnegative(),
});
export type OracleJson = z.infer<typeof OracleJsonSchema>;
