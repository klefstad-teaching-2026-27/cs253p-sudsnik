import { z } from "zod";
import { MOCKS } from "./sim.js";
import { SERVICES } from "./topics.js";

export const SERVICE_URL_VARS = SERVICES.map((s) => `SUDSNIK_${s.toUpperCase()}_URL` as const);
export const MOCK_URL_VARS = MOCKS.map((m) => `SUDSNIK_${m.toUpperCase().replace("-", "_")}_URL` as const);

export function serviceUrlVar(service: (typeof SERVICES)[number]): string {
  return `SUDSNIK_${service.toUpperCase()}_URL`;
}
export function mockUrlVar(mock: (typeof MOCKS)[number]): string {
  return `SUDSNIK_${mock.toUpperCase().replace("-", "_")}_URL`;
}

const url = z.string().url();
const port = z.coerce.number().int().min(1).max(65535);

const urlVars = Object.fromEntries([...SERVICE_URL_VARS, ...MOCK_URL_VARS].map((v) => [v, url])) as Record<
  (typeof SERVICE_URL_VARS)[number] | (typeof MOCK_URL_VARS)[number],
  typeof url
>;

/** The common set every service reads (system-spec §5.3). */
export const CommonEnvSchema = z.object({
  SUDSNIK_PORT: port,
  SUDSNIK_SEED: z.string().regex(/^[0-9a-f]{16}$/),
  SUDSNIK_DATA_DIR: z.string().min(1),
  SUDSNIK_BUS_URL: z.string().min(1),
  SUDSNIK_CLOCK_RATE: z.coerce.number().positive().default(600),
  SUDSNIK_TENANT_KEYS: z.string().regex(/^[a-z0-9]+:[^,]+(,[a-z0-9]+:[^,]+)*$/),
  SUDSNIK_FLAGS: z.string().default(""),
  SUDSNIK_SIM_URL: url,
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ...urlVars,
});
export type CommonEnv = z.infer<typeof CommonEnvSchema>;

export function parseTenantKeys(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const [op, key] = pair.split(":");
    if (!op || !key) throw new RangeError(`bad SUDSNIK_TENANT_KEYS entry ${pair}`);
    out[op] = key;
  }
  return out;
}

export const DEFAULT_PORTS = {
  gateway: 4000,
  orders: 4001,
  dispatch: 4002,
  washnodes: 4003,
  billing: 4004,
  tracking: 4005,
  accounts: 4006,
  notify: 4007,
  support: 4008,
  payments: 4100,
  ephemeris: 4101,
  identity: 4102,
  "washer-v1": 4103,
  "washer-v2": 4104,
  relay: 4105,
  oracle: 4106,
  sim: 4200,
} as const;
