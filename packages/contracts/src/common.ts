import { z } from "zod";

export const IdSchema = z.string().min(1).max(64);
export const UlidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
export const SimMsSchema = z.number().int().nonnegative();
export const MoneySchema = z.object({ amount: z.number().int(), currency: z.string().length(3) });
export type Money = z.infer<typeof MoneySchema>;
export const OrbitPhaseSchema = z.number().min(0).lt(1);

export const CtxSchema = z.object({
  tenantId: IdSchema,
  idempotencyKey: z.string().min(1).max(128).optional(),
  correlationId: z.string().min(1).max(64),
});
export type Ctx = z.infer<typeof CtxSchema>;

export const IDEMPOTENCY_HEADER = "idempotency-key";
export const TENANT_HEADER = "x-sudsnik-tenant";
/** Carries `SUDSNIK_SIM_TOKEN` on every simulator control call (system-spec §7); under the grader the stack is not given the token. */
export const SIM_TOKEN_HEADER = "x-sudsnik-sim-token";
export const CORRELATION_HEADER = "x-correlation-id";
export const DRIVER_HEADER = "x-sudsnik-driver";

export const ErrorBodySchema = z.object({
  code: z.enum(["INVALID", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "QUOTA", "INTERNAL", "UNAVAILABLE", "TIMEOUT"]),
  message: z.string(),
  retryable: z.boolean(),
  correlationId: z.string().optional(),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

/** Header schema for every public write route (system-spec §5.4 `idempotency-key-on-writes`). */
export const IdempotencyHeaders = z.object({ "idempotency-key": z.string().min(1).max(128) });
