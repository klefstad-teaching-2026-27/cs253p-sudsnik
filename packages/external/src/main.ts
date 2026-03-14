import { MOCKS, mockUrlVar, parseTenantKeys, type MockName } from "@sudsnik/contracts";
import { isSeed } from "@sudsnik/kernel";
import { startAllMocks } from "./index.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

const seed = required("SUDSNIK_SEED");
if (!isSeed(seed)) throw new Error("SUDSNIK_SEED must be 16 hex characters");
const ports: Partial<Record<MockName, number>> = {};
for (const name of MOCKS) {
  const url = process.env[mockUrlVar(name)];
  if (url) ports[name] = Number(new URL(url).port);
}

const running = await startAllMocks({
  seed,
  dataDir: required("SUDSNIK_DATA_DIR"),
  tenantKeys: parseTenantKeys(required("SUDSNIK_TENANT_KEYS")),
  ports,
  ...(process.env.SUDSNIK_RELAY_URL ? { relayUrl: process.env.SUDSNIK_RELAY_URL } : {}),
  ...(process.env.SUDSNIK_SIM_TOKEN ? { simToken: process.env.SUDSNIK_SIM_TOKEN } : {}),
});
for (const [name, url] of Object.entries(running.urls)) console.log(`${name} ${url}`);

const stop = () => void running.close().then(() => process.exit(0));
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
