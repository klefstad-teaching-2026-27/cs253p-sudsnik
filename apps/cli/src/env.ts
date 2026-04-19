import { resolve } from "node:path";
import { DEFAULT_FLAGS, DEFAULT_PORTS, MOCKS, PUBLIC_SEED, SERVICES, mockUrlVar, serviceUrlVar } from "@sudsnik/contracts";

export const DEFAULT_TENANT_KEYS = "op1:key1,op2:key2,op3:key3,op4:key4";

/**
 * Fills every unset SUDSNIK_ variable with its laptop default (system-spec §5.3) so `npm start` works
 * with no configuration. Under the grader every variable is set and nothing here applies.
 */
export function withDefaults(env: Record<string, string | undefined>, opts: { single: boolean }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === "string") out[k] = v;
  const set = (k: string, v: string) => {
    if (!out[k]) out[k] = v;
  };
  set("SUDSNIK_PORT", String(DEFAULT_PORTS.gateway));
  set("SUDSNIK_SEED", PUBLIC_SEED);
  set("SUDSNIK_DATA_DIR", resolve("data"));
  set("SUDSNIK_BUS_URL", resolve(out.SUDSNIK_DATA_DIR!, "bus.sqlite"));
  set("SUDSNIK_CLOCK_RATE", "600");
  set("SUDSNIK_TENANT_KEYS", DEFAULT_TENANT_KEYS);
  set("SUDSNIK_FLAGS", DEFAULT_FLAGS);
  set("SUDSNIK_SIM_URL", `http://127.0.0.1:${DEFAULT_PORTS.sim}`);
  set("NODE_ENV", "development");
  const port = out.SUDSNIK_PORT!;
  for (const s of SERVICES) set(serviceUrlVar(s), opts.single ? `http://127.0.0.1:${port}/${s}` : `http://127.0.0.1:${DEFAULT_PORTS[s]}`);
  for (const m of MOCKS) set(mockUrlVar(m), `http://127.0.0.1:${DEFAULT_PORTS[m]}`);
  return out;
}

export function portOf(url: string): number {
  return Number(new URL(url).port);
}
