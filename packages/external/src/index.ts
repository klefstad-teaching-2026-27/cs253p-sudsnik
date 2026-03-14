import type { FastifyInstance } from "fastify";
import { DEFAULT_PORTS, MOCKS, type MockName } from "@sudsnik/contracts";
import { subSeed } from "@sudsnik/kernel";
import { createMock as ephemeris } from "./ephemeris/index.js";
import { createMock as identity } from "./identity/index.js";
import { createMock as oracle } from "./oracle/index.js";
import { createMock as payments } from "./payments/index.js";
import { createMock as relay } from "./relay/index.js";
import { createMock as washerV1 } from "./washer-v1/index.js";
import { createMock as washerV2 } from "./washer-v2/index.js";
import type { MockOptions } from "./mock.js";

export type { MockOptions, MockStats, QuotaRefusals } from "./mock.js";
export type { PaymentsOptions } from "./payments/index.js";
export type { IdentityOptions } from "./identity/index.js";
export type { WasherV2Options } from "./washer-v2/index.js";

/** Everything any mock needs; each `createMock` reads the subset it declares. */
export interface AllMockOptions extends MockOptions {
  tenantKeys: Record<string, string>;
  relayUrl: string;
}

export const createMock: Record<MockName, (opts: AllMockOptions) => Promise<FastifyInstance>> = {
  payments,
  ephemeris,
  identity,
  "washer-v1": washerV1,
  "washer-v2": washerV2,
  relay,
  oracle,
};

export interface StartAllOptions {
  /** The scenario seed; each mock gets its sub-seed by name (system-spec §5.3). */
  seed: string;
  dataDir: string;
  ports?: Partial<Record<MockName, number>>;
  tenantKeys: Record<string, string>;
  /** Where callbacks go; defaults to this process's own relay. */
  relayUrl?: string;
  /** Required on every mock's `/_sim/*` routes when set (`MockOptions.simToken`). */
  simToken?: string;
}

export interface RunningMocks {
  urls: Record<MockName, string>;
  close(): Promise<void>;
}

export async function startAllMocks(opts: StartAllOptions): Promise<RunningMocks> {
  const apps: FastifyInstance[] = [];
  const urls = {} as Record<MockName, string>;
  const listen = async (name: MockName, relayUrl: string): Promise<void> => {
    const app = await createMock[name]({ seed: subSeed(opts.seed, name), dataDir: opts.dataDir, tenantKeys: opts.tenantKeys, relayUrl, ...(opts.simToken ? { simToken: opts.simToken } : {}) });
    apps.push(app);
    await app.listen({ port: opts.ports?.[name] ?? DEFAULT_PORTS[name], host: "127.0.0.1" });
    urls[name] = boundUrl(app);
  };
  try {
    if (!opts.relayUrl) await listen("relay", "");
    const relayUrl = opts.relayUrl ?? urls.relay;
    for (const name of MOCKS) if (!urls[name]) await listen(name, relayUrl);
  } catch (e) {
    await Promise.all(apps.map((a) => a.close()));
    throw e;
  }
  return { urls, close: async () => void (await Promise.all(apps.map((a) => a.close()))) };
}

/** The listening address; `ports` may name 0 for an ephemeral port. */
export function boundUrl(app: FastifyInstance): string {
  const address = app.server.address();
  if (typeof address !== "object" || !address) throw new Error("app is not listening");
  return `http://127.0.0.1:${address.port}`;
}
