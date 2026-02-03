import type { Meter as OtelMeter, Tracer } from "@opentelemetry/api";
import type { Clock, Result } from "@sudsnik/kernel";
import type { Op } from "./canon.js";
import type { Clients } from "./clients.js";
import type { Envelope } from "./envelope.js";
import type { Flags } from "./flags.js";
import type { Service, Topic } from "./topics.js";
import type { Stop } from "@sudsnik/kernel";

export interface Bus {
  publish(envelope: Envelope): Promise<void>;
  subscribe(topic: Topic, handler: (envelope: Envelope) => Promise<Result<void>>, opts: { consumer: string }): Stop;
}

export interface Meter {
  charge(op: Op, count: number, tags: { service: string; endpoint?: string }): void;
}

export interface LogFields {
  [key: string]: unknown;
}

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export interface Telemetry {
  tracer: Tracer;
  meter: OtelMeter;
  logger: Logger;
  /** Named monotonic counters a service increments; alert rules read them. */
  counter(name: string): { add(n?: number): void };
  counters(): Record<string, number>;
}

export interface ServiceDeps {
  service: Service;
  env: Record<string, string>;
  clock: Clock;
  bus: Bus;
  meter: Meter;
  flags: Flags;
  clients: Clients;
  telemetry: Telemetry;
  dataDir: string;
  handlersDir: string;
}

export interface Handler<P = unknown> {
  topic: Topic;
  handle(envelope: Envelope<P>, deps: ServiceDeps): Promise<Result<void>>;
}

export interface CostEntry {
  count: number;
  units: number;
}

export interface CostResponse {
  service: string;
  sinceMs: number;
  totalUnits: number;
  byOperation: Record<string, CostEntry>;
  byEndpoint: Record<string, CostEntry>;
}

export interface VersionResponse {
  service: string;
  version: string;
  contractsVersion: string;
  variant: string;
  gitSha: string;
}

export interface AlertMetrics {
  cost: CostResponse;
  counters: Record<string, number>;
  nowMs: number;
}

export interface AlertRule {
  name: string;
  every: number;
  evaluate(metrics: AlertMetrics): boolean;
}
