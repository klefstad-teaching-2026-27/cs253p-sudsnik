import type { FastifyInstance } from "fastify";
import { ORBIT_MS } from "@sudsnik/contracts";
import { TokenRequest, type TokenResponse, type VerifyResponse } from "@sudsnik/contracts/mocks/identity";
import { createMockApp, type MockOptions } from "../mock.js";

export const VERIFY_ERROR_RATE = 0.01;
export const TOKEN_TTL_MS = 100 * ORBIT_MS;
export const OPERATOR_SCOPES = ["orders:read", "orders:write", "tracking:read", "support:write", "accounts:read"] as const;

export interface IdentityOptions extends MockOptions {
  /** `operatorId -> key`, from `SUDSNIK_TENANT_KEYS`. */
  tenantKeys: Record<string, string>;
}

interface Issued {
  operatorId: string;
  scopes: string[];
  expiresAtMs: number;
}

export async function createMock(opts: IdentityOptions): Promise<FastifyInstance> {
  const mock = await createMockApp("identity", opts);
  const { app } = mock;
  const tokens = new Map<string, Issued>();

  app.post("/token", { schema: { body: TokenRequest } }, async (req, reply) => {
    const { operatorId, key } = req.body;
    if (opts.tenantKeys[operatorId] !== key) return mock.fail(reply, "UNAUTHORIZED", "unknown operator or wrong key");
    const token = mock.id(`tok_${operatorId}`);
    const issued: Issued = { operatorId, scopes: [...OPERATOR_SCOPES], expiresAtMs: mock.nowMs() + TOKEN_TTL_MS };
    tokens.set(token, issued);
    const body: TokenResponse = { token, operatorId, expiresAtMs: issued.expiresAtMs };
    return reply.code(201).send(body);
  });

  app.get("/verify", async (req, reply) => {
    if (mock.rng("faults").chance(mock.rate("error-burst", VERIFY_ERROR_RATE))) {
      return mock.fail(reply, "UNAVAILABLE", "identity is briefly unavailable", { "retry-after": "1" });
    }
    const auth = req.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : undefined;
    const issued = token ? tokens.get(token) : undefined;
    if (!issued) return mock.fail(reply, "UNAUTHORIZED", "missing or unknown bearer token");
    if (issued.expiresAtMs <= mock.nowMs()) return mock.fail(reply, "UNAUTHORIZED", "token expired");
    const body: VerifyResponse = { operatorId: issued.operatorId, scopes: issued.scopes };
    return body;
  });

  return app;
}
