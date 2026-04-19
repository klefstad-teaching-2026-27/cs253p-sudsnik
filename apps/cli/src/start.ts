import { DEFAULT_PORTS, SERVICES, mockUrlVar, serviceUrlVar, type Service } from "@sudsnik/contracts";
import { parseFlags } from "@sudsnik/contracts";
import { ENTRIES, repoRoot, spawnTs, stopAll, type Child } from "./children.js";
import { portOf, withDefaults } from "./env.js";
import { createSingleStack } from "./single.js";
import { waitForReady } from "./wait.js";

export interface StartOptions {
  single: boolean;
  mocks: boolean;
  sim: boolean;
  env?: Record<string, string | undefined>;
}

export interface RunningStack {
  env: Record<string, string>;
  rootUrl: string;
  stop(): Promise<void>;
  /** Drains the services and starts them again on the same data directory; the mocks and the simulator stay up. */
  restart(): Promise<void>;
}

/** `apps/cli start`: the stack in either topology, plus the mocks and an idle simulator unless told otherwise. */
export async function startStack(opts: StartOptions): Promise<RunningStack> {
  const env = withDefaults(opts.env ?? process.env, { single: opts.single });
  const children: Child[] = [];
  const root = repoRoot();
  if (opts.mocks) children.push(spawnTs("mocks", `${root}/${ENTRIES.mocks}`, env));
  let single: Awaited<ReturnType<typeof createSingleStack>> | undefined;
  const isService = (c: Child) => c.name !== "mocks" && c.name !== "sim";
  async function startServices(): Promise<void> {
    if (opts.single) {
      single = await createSingleStack(env);
      await single.listen(Number(env.SUDSNIK_PORT));
      return;
    }
    const flags = parseFlags(env.SUDSNIK_FLAGS);
    for (const s of SERVICES) {
      if (s !== "gateway" && !flags.isOn(`${s}.enabled`)) continue;
      children.push(spawnTs(s, `${root}/${ENTRIES.service}`, { ...env, SUDSNIK_PORT: String(portOf(env[serviceUrlVar(s)]!)) }, [s]));
    }
  }
  async function stopServices(): Promise<void> {
    if (single) {
      await single.drain();
      single = undefined;
      return;
    }
    const services = children.filter(isService);
    await stopAll(services);
    for (const c of services) children.splice(children.indexOf(c), 1);
  }
  await startServices();
  const rootUrl = opts.single ? `http://127.0.0.1:${env.SUDSNIK_PORT}` : env[serviceUrlVar("gateway")]!;
  const ready = await waitForReady(`${rootUrl}/ready`, 30_000);
  if (!ready) {
    await stopAll(children);
    await stopServices();
    throw new Error(`stack not ready at ${rootUrl}/ready within 30 s`);
  }
  if (opts.sim) children.push(spawnTs("sim", `${root}/${ENTRIES.sim}`, env));
  return {
    env,
    rootUrl,
    async stop() {
      const sim = children.filter((c) => c.name === "sim");
      await stopAll(sim);
      await stopServices();
      await stopAll(children.filter((c) => c.name !== "sim"));
    },
    async restart() {
      await stopServices();
      await startServices();
      if (!(await waitForReady(`${rootUrl}/ready`, 30_000))) throw new Error(`stack not ready at ${rootUrl}/ready within 30 s of restarting`);
    },
  };
}

export function describeEnv(env: Record<string, string>): string {
  const lines = [`stack   ${env[serviceUrlVar("gateway")]}`];
  for (const s of SERVICES) lines.push(`  ${s.padEnd(10)} ${env[serviceUrlVar(s)]}`);
  for (const m of ["payments", "ephemeris", "identity", "washer-v1", "washer-v2", "relay", "oracle"] as const) lines.push(`  ${m.padEnd(10)} ${env[mockUrlVar(m)]}`);
  lines.push(`  sim        ${env.SUDSNIK_SIM_URL} (default port ${DEFAULT_PORTS.sim})`);
  return lines.join("\n");
}

export type { Service };
