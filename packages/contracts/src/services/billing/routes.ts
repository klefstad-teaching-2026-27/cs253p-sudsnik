import { z } from "zod";
import { IdSchema, SimMsSchema } from "../../common.js";
import { PaymentsWebhook } from "../../mocks/payments.js";

export const Quote = z.object({
  orderId: IdSchema,
  amount: z.number().int().nonnegative(),
  currency: z.string().length(3),
  breakdown: z.object({ base: z.number().int(), cycleUnits: z.number().int(), tier: z.string() }),
});
export type Quote = z.infer<typeof Quote>;

export const ChargeState = z.enum(["authorized", "captured", "failed", "refunded"]);
export const Charge = z.object({
  chargeId: IdSchema,
  tenantId: IdSchema,
  orderId: IdSchema,
  amount: z.number().int().nonnegative(),
  currency: z.string().length(3),
  state: ChargeState,
  paymentRef: IdSchema.optional(),
  updatedAt: SimMsSchema,
});
export type Charge = z.infer<typeof Charge>;

/**
 * One line of the ledger, shaped as ADR-0004 settled it for the pre-launch import: the order it belongs to, what
 * kind of movement it was, and the money. Nothing here is ever updated.
 */
export const LedgerEntry = z.object({
  entryId: IdSchema,
  tenantId: IdSchema,
  orderId: IdSchema,
  kind: z.enum(["authorize", "capture", "refund", "fee"]),
  amount: z.number().int(),
  currency: z.string().length(3),
  at: SimMsSchema,
  ref: IdSchema.optional(),
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;
export const LedgerFilter = z.object({ orderId: IdSchema.optional(), limit: z.coerce.number().int().min(1).max(500).default(100) });
export type LedgerFilter = z.infer<typeof LedgerFilter>;

export const routes = {
  quote: { method: "GET", path: "/quotes/:orderId", response: Quote },
  authorize: { method: "POST", path: "/charges/authorize", body: z.object({ orderId: IdSchema, amount: z.number().int().nonnegative() }), response: Charge, idempotent: true },
  capture: { method: "POST", path: "/charges/:orderId/capture", response: Charge, idempotent: true },
  refund: { method: "POST", path: "/charges/:orderId/refund", response: Charge, idempotent: true },
  ledger: { method: "GET", path: "/ledger", query: LedgerFilter, response: z.array(LedgerEntry) },
  paymentsWebhook: { method: "POST", path: "/callbacks/payments", body: PaymentsWebhook, response: z.object({ accepted: z.boolean(), duplicate: z.boolean() }) },
} as const;
