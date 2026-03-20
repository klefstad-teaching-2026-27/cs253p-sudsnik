import { MINUTE_MS, type ServiceDeps } from "@sudsnik/contracts";
import type { VerifyResponse } from "@sudsnik/contracts/mocks/identity";
import { createCache } from "@sudsnik/infra-cache";
import { ok } from "@sudsnik/kernel";
import type { Verifier } from "./auth.js";

export const VERIFY_TTL_MS = 10 * MINUTE_MS;
export const VERIFY_CACHE_MAX = 10_000;

/** identity's answer, remembered per token for ten simulated minutes; a refusal is never remembered. */
export const createCachedVerifier = (deps: ServiceDeps): Verifier => {
  const cache = createCache<VerifyResponse>({ max: VERIFY_CACHE_MAX, ttlMs: VERIFY_TTL_MS, clock: deps.clock, meter: deps.meter, service: deps.service });
  return async (token) => {
    const hit = cache.get(token);
    if (hit) return ok(hit);
    const verified = await deps.clients.identity.verify(token);
    if (verified.ok) cache.set(token, verified.value);
    return verified;
  };
};
