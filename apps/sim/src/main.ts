import { FLAG_NAMES, parseFlags, DEFAULT_PORTS, MOCKS, SCENARIOS, SYSTEM_TENANT, SIM_TOKEN_HEADER, TENANT_HEADER, mockUrlVar, type MockName, type SimState } from "@sudsnik/contracts";
import type { DeliverRequest } from "@sudsnik/contracts/mocks/relay";
import { openBus } from "@sudsnik/infra-queue";
import { SimClock } from "@sudsnik/kernel";
import { z } from "zod";
import { createServer } from "./server.js";
import { createSim } from "./sim.js";

const READY_WAIT_MS = 60_000;
const READY_POLL_MS = 500;
const HTTP_TIMEOUT_MS = 2_000;

const EnvSchema = z.object({
  SUDSNIK_SEED: z.string().regex(/^[0-9a-f]{16}$/),
  SUDSNIK_BUS_URL: z.string().min(1),
  SUDSNIK_DATA_DIR: z.string().min(1),
  SUDSNIK_CLOCK_RATE: z.coerce.number().positive().default(600),
  SUDSNIK_SIM_URL: z.string().url().default(`http://127.0.0.1:${DEFAULT_PORTS.sim}`),
  SUDSNIK_GATEWAY_URL: z.string().url(),
  SUDSNIK_DISPATCH_URL: z.string().url(),
  SUDSNIK_TRACKING_URL: z.string().url(),
  SUDSNIK_RELAY_URL: z.string().url(),
  SUDSNIK_SCENARIO: z.enum(SCENARIOS).optional(),
  SUDSNIK_SCALE: z.coerce.number().positive().default(1),
  SUDSNIK_FAULTS: z.string().min(1).optional(),
  SUDSNIK_SIM_TOKEN: z.string().min(1).optional(),
  SUDSNIK_FLAGS: z.string().default(""),
  /** The storm's hidden draw derives from this rather than SUDSNIK_SEED where the grader sets it, since the stack under test holds the run seed. */
  SUDSNIK_HIDDEN_SEED: z.string().regex(/^[0-9a-f]{16}$/).optional(),
});

function log(event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ service: "sim", event, ...fields })}\n`);
}

async function waitForReady(readyUrl: string): Promise<void> {
  const deadline = Date.now() + READY_WAIT_MS;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(readyUrl, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
      if (res.status === 200) return;
      lastError = `status ${res.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
  throw new Error(`stack at ${readyUrl} not ready after ${READY_WAIT_MS / 1000} s (${lastError})`);
}

async function main(): Promise<void> {
  const env = EnvSchema.parse(process.env);
  const mockUrls = new Map<MockName, string>();
  for (const mock of MOCKS) {
    const url = process.env[mockUrlVar(mock)];
    if (url) mockUrls.set(mock, url);
  }

  await waitForReady(new URL("/ready", env.SUDSNIK_GATEWAY_URL).toString());
  const bus = openBus({ path: env.SUDSNIK_BUS_URL, clock: new SimClock(), meter: { charge() {} } });

  const postState = async (mock: MockName, state: SimState): Promise<void> => {
    const base = mockUrls.get(mock);
    if (!base) return;
    const res = await fetch(new URL("/_sim/state", base), {
      method: "POST",
      headers: { "content-type": "application/json", ...(env.SUDSNIK_SIM_TOKEN ? { [SIM_TOKEN_HEADER]: env.SUDSNIK_SIM_TOKEN } : {}) },
      body: JSON.stringify(state),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${mock} /_sim/state ${res.status}`);
  };

  const deliver = async (req: DeliverRequest): Promise<boolean> => {
    const res = await fetch(new URL("/deliver", env.SUDSNIK_RELAY_URL), {
      method: "POST",
      headers: { "content-type": "application/json", [TENANT_HEADER]: SYSTEM_TENANT },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    return res.ok;
  };

  const sim = createSim({
    bus,
    postState,
    deliver,
    urls: { dispatch: env.SUDSNIK_DISPATCH_URL, tracking: env.SUDSNIK_TRACKING_URL },
    seed: env.SUDSNIK_SEED,
    ...(env.SUDSNIK_HIDDEN_SEED ? { hiddenSeed: env.SUDSNIK_HIDDEN_SEED } : {}),
    dataDir: env.SUDSNIK_DATA_DIR,
    clockRate: env.SUDSNIK_CLOCK_RATE,
    mocks: [...mockUrls.keys()],
    flags: FLAG_NAMES.filter((f) => parseFlags(env.SUDSNIK_FLAGS).isOn(f)),
    log,
  });

  const app = createServer(sim, env.SUDSNIK_SIM_TOKEN);
  const port = Number(new URL(env.SUDSNIK_SIM_URL).port) || DEFAULT_PORTS.sim;
  await app.listen({ port, host: "127.0.0.1" });
  if (env.SUDSNIK_SCENARIO) {
    const run = sim.run({ scenario: env.SUDSNIK_SCENARIO, scale: env.SUDSNIK_SCALE, faultsPath: env.SUDSNIK_FAULTS });
    log("sim.run.staged", { scenario: run.scenario.name, scale: run.scale, faults: run.faults.length });
  } else {
    log("sim.idle", { port });
  }
  sim.ticker.start();
  log("sim.listening", { port, clockRate: env.SUDSNIK_CLOCK_RATE, mocks: [...mockUrls.keys()] });

  const shutdown = async (): Promise<void> => {
    sim.ticker.stop();
    await app.close();
    bus.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((e) => {
  log("sim.fatal", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
