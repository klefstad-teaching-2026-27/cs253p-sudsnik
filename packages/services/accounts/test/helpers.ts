import { IDEMPOTENCY_HEADER, TENANT_HEADER } from "@sudsnik/contracts";
import { fakeDeps, type FakeDeps } from "@sudsnik/contracts/testing";
import { createApp as createGolden } from "../src/variants/golden/index.js";
import { createApp as createHollow } from "../src/variants/hollow/index.js";
import { createApp as createNaive } from "../src/variants/naive/index.js";
import { handlersDir } from "../src/index.js";

export const SEED = "00000000c0ffee00";
export const variants = { golden: createGolden, naive: createNaive } as const;
export const createHollowApp = createHollow;
export type Variant = keyof typeof variants;
export type TestApp = Awaited<ReturnType<typeof createGolden>>;

export async function boot(create: (deps: FakeDeps) => Promise<TestApp>): Promise<{ app: TestApp; deps: FakeDeps }> {
  const deps = fakeDeps(SEED, "accounts", { handlersDir });
  const app = await create(deps);
  return { app, deps };
}

let keys = 0;
export function headers(tenant: string, key?: string): Record<string, string> {
  return { [TENANT_HEADER]: tenant, [IDEMPOTENCY_HEADER]: key ?? `k${++keys}` };
}

export function get(app: TestApp, url: string, tenant: string) {
  return app.inject({ method: "GET", url, headers: { [TENANT_HEADER]: tenant } });
}

export function put(app: TestApp, url: string, tenant: string, payload: object, key?: string) {
  return app.inject({ method: "PUT", url, headers: headers(tenant, key), payload });
}
