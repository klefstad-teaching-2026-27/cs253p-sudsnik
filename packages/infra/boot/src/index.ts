import { join } from "node:path";
import type { z } from "zod";
import { createClients } from "@sudsnik/clients";
import { CommonEnvSchema, parseFlags, type Flags, type Service, type ServiceDeps, type Telemetry } from "@sudsnik/contracts";
import { createBaseApp, listen, type App, type BaseAppOptions, type SudsnikApp } from "@sudsnik/infra-http";
import { createMeterSink, type MeterSink } from "@sudsnik/infra-metering";
import { openBus, type BusConnection } from "@sudsnik/infra-queue";
import { createTelemetryProvider, type TelemetryProvider } from "@sudsnik/infra-telemetry";
import { SimClock, err, ok, sudsnikError, type Result } from "@sudsnik/kernel";

export interface ProcessContext {
  env: Record<string, string>;
  dataDir: string;
  clock: SimClock;
  bus: BusConnection;
  meter: MeterSink;
  telemetry: TelemetryProvider;
  flags: Flags;
  close(): Promise<void>;
}

/** Everything one process shares between the services it hosts: one clock, one bus connection, one meter sink, one telemetry provider. */
export function createProcessContext(env: Record<string, string>): ProcessContext {
  const common = CommonEnvSchema.parse(env);
  const clock = new SimClock();
  const meter = createMeterSink(0);
  const bus = openBus({ path: common.SUDSNIK_BUS_URL, clock, meter });
  const telemetry = createTelemetryProvider({ dataDir: common.SUDSNIK_DATA_DIR, clock });
  bus.start();
  return {
    env,
    dataDir: common.SUDSNIK_DATA_DIR,
    clock,
    bus,
    meter,
    telemetry,
    flags: parseFlags(common.SUDSNIK_FLAGS),
    async close() {
      await bus.stop();
      await telemetry.shutdown();
      bus.close();
    },
  };
}

export interface ServiceDirs {
  handlersDir: string;
}

export function depsFor(ctx: ProcessContext, service: Service, dirs: ServiceDirs): ServiceDeps & { telemetry: Telemetry } {
  const clients = createClients({ service, env: ctx.env, meter: ctx.meter, clock: ctx.clock });
  return {
    service,
    env: ctx.env,
    clock: ctx.clock,
    bus: ctx.bus.forService(service),
    meter: ctx.meter,
    flags: ctx.flags,
    clients,
    telemetry: ctx.telemetry.forService(service),
    dataDir: ctx.dataDir,
    handlersDir: dirs.handlersDir,
  };
}

/** `readEnv()` as system-spec §5.1 requires: the service's zod schema over process.env, as a Result. */
export function readEnvWith<S extends z.ZodTypeAny>(schema: S, source: Record<string, string | undefined> = process.env): Result<z.infer<S>> {
  const parsed = schema.safeParse(source);
  if (parsed.success) return ok(parsed.data as z.infer<S>);
  const missing = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  return err(sudsnikError("INVALID", `environment invalid: ${missing}`));
}

export interface ServiceModule {
  service: Service;
  readEnv(): Result<Record<string, unknown>>;
  createApp(deps: ServiceDeps): Promise<App & { sudsnik: SudsnikApp }>;
  start(): Promise<void>;
  handlersDir: string;
}

/** The body of a service's `start()`: env, process context, deps, app, listen, and drain on SIGTERM. */
export async function bootService(mod: Omit<ServiceModule, "start">): Promise<{ port: number; close(): Promise<void> }> {
  const envResult = mod.readEnv();
  if (!envResult.ok) throw new Error(envResult.error.message);
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"));
  const ctx = createProcessContext(env);
  const deps = depsFor(ctx, mod.service, { handlersDir: mod.handlersDir });
  const app = await mod.createApp(deps);
  const port = Number(env.SUDSNIK_PORT);
  return listen(app, port, { afterDrain: () => ctx.close() });
}

export const baseAppFor = (deps: ServiceDeps, ctx: Pick<ProcessContext, "meter">, opts: Omit<BaseAppOptions, "deps" | "cost">) =>
  createBaseApp({ deps, cost: () => ctx.meter.cost(deps.service), ...opts });

export function serviceDataFile(deps: ServiceDeps, name = deps.service): string {
  return join(deps.dataDir, `${name}.sqlite`);
}
