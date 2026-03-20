import { z } from "zod";
import type { CallOptions, HttpClient } from "@sudsnik/clients";
import { MINUTE_MS } from "@sudsnik/contracts";
import { errorBody } from "@sudsnik/infra-http";
import { httpStatus } from "@sudsnik/kernel";

/** Simulated ms before a forward gives up; a tick is a minute, so anything shorter fires at the next tick. */
export const FORWARD_TIMEOUT_MS = 5 * MINUTE_MS;

export interface UpstreamResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

const UpstreamFailure = z.object({ status: z.number().int(), headers: z.record(z.string(), z.string()).default({}), body: z.unknown() });

/** The upstream's answer as it was, non-2xx included; only a failure to get one becomes a gateway error. */
export const callUpstream = async (http: HttpClient, call: CallOptions, correlationId: string): Promise<UpstreamResponse> => {
  const r = await http.call(call);
  if (r.ok) return { status: r.value.status, headers: r.value.headers, body: r.value.value };
  const failure = UpstreamFailure.safeParse(r.error.cause);
  if (failure.success) return { status: failure.data.status, headers: failure.data.headers, body: failure.data.body ?? errorBody(r.error, correlationId) };
  return { status: httpStatus(r.error.code), headers: {}, body: errorBody(r.error, correlationId) };
};
