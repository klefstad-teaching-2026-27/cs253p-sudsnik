import type { FastifyRequest } from "fastify";
import { VerifyResponse } from "@sudsnik/contracts/mocks/identity";
import { err, ok, sudsnikError, type Result } from "@sudsnik/kernel";
import { requestHeader } from "./headers.js";

export type Verifier = (token: string) => Promise<Result<VerifyResponse>>;

const BEARER = /^Bearer\s+(\S+)$/i;

export const bearerToken = (authorization: string | undefined): string | undefined => (authorization === undefined ? undefined : BEARER.exec(authorization)?.[1]);

/** The operator behind the request's bearer token: 401 for no or bad token, 503 when identity cannot say. */
export const authenticate = async (req: FastifyRequest, verify: Verifier): Promise<Result<VerifyResponse>> => {
  const token = bearerToken(requestHeader(req, "authorization"));
  if (token === undefined) return err(sudsnikError("UNAUTHORIZED", "missing or malformed Authorization: Bearer <token>"));
  const verified = await verify(token);
  if (!verified.ok) {
    if (verified.error.code === "UNAUTHORIZED") return err(sudsnikError("UNAUTHORIZED", "invalid token"));
    return err(sudsnikError("UNAVAILABLE", `identity unavailable: ${verified.error.message}`, verified.error));
  }
  const parsed = VerifyResponse.safeParse(verified.value);
  if (!parsed.success) return err(sudsnikError("UNAVAILABLE", "identity returned a malformed verify response"));
  return ok(parsed.data);
};
