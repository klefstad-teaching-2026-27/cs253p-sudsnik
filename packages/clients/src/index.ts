import { mockUrlVar, serviceUrlVar, type Clients, type Meter } from "@sudsnik/contracts";
import type { Clock } from "@sudsnik/kernel";
import { createHttpClient, type HttpClient } from "./http.js";
import { ephemerisClient, identityClient, oracleClient, paymentsClient, relayClient, washerV1Client, washerV2Client } from "./mocks.js";
import { accountsClient, billingClient, dispatchClient, notifyClient, ordersClient, supportClient, trackingClient, washnodesClient } from "./services.js";

export interface CreateClientsOptions {
  service: string;
  env: Record<string, string>;
  meter: Meter;
  clock: Clock;
  timeoutMs?: { internal: number; external: number };
  /** Wall-clock ms before a call is aborted; the release driver's, never a service's (see `createHttpClient`). */
  wallTimeoutMs?: number;
  driver?: boolean;
}

/** Simulated milliseconds; a timeout shorter than a tick resolves at the next tick, so defaults are in minutes. */
export const DEFAULT_TIMEOUTS = { internal: 5 * 60_000, external: 5 * 60_000 };

/** Every client a service may receive, bound to the URLs in env; each call is metered to `service`. */
export function createClients(opts: CreateClientsOptions): Clients & { http: HttpClient } {
  const http = createHttpClient({ service: opts.service, meter: opts.meter, clock: opts.clock, timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUTS, wallTimeoutMs: opts.wallTimeoutMs, driver: opts.driver });
  const url = (v: string) => {
    const u = opts.env[v];
    if (!u) throw new RangeError(`missing ${v}`);
    return u.replace(/\/$/, "");
  };
  return {
    http,
    orders: ordersClient(http, url(serviceUrlVar("orders"))),
    dispatch: dispatchClient(http, url(serviceUrlVar("dispatch"))),
    washnodes: washnodesClient(http, url(serviceUrlVar("washnodes"))),
    billing: billingClient(http, url(serviceUrlVar("billing"))),
    tracking: trackingClient(http, url(serviceUrlVar("tracking"))),
    accounts: accountsClient(http, url(serviceUrlVar("accounts"))),
    notify: notifyClient(http, url(serviceUrlVar("notify"))),
    support: supportClient(http, url(serviceUrlVar("support"))),
    payments: paymentsClient(http, url(mockUrlVar("payments"))),
    ephemeris: ephemerisClient(http, url(mockUrlVar("ephemeris"))),
    identity: identityClient(http, url(mockUrlVar("identity"))),
    washerV1: washerV1Client(http, url(mockUrlVar("washer-v1"))),
    washerV2: washerV2Client(http, url(mockUrlVar("washer-v2"))),
    relay: relayClient(http, url(mockUrlVar("relay"))),
    oracle: oracleClient(http, url(mockUrlVar("oracle"))),
  };
}

export { createHttpClient } from "./http.js";
export type { HttpClient, HttpClientOptions, CallOptions, HttpResponse } from "./http.js";
export * from "./services.js";
export * from "./mocks.js";
