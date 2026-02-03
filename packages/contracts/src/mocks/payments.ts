import { z } from "zod";
import { IdSchema, MoneySchema, SimMsSchema } from "../common.js";

export const AuthorizeRequest = z.object({
  orderId: IdSchema,
  amount: z.number().int().nonnegative(),
  currency: z.string().length(3),
  callbackUrl: z.string().url(),
});
export const PaymentState = z.enum(["authorized", "captured", "refunded", "failed"]);
export const PaymentResponse = z.object({ paymentRef: IdSchema, state: PaymentState, amount: z.number().int(), currency: z.string() });
export const CaptureRequest = z.object({ paymentRef: IdSchema, amount: z.number().int().nonnegative().optional() });
export const RefundRequest = z.object({ paymentRef: IdSchema, amount: z.number().int().nonnegative().optional() });

/** Delivered at POST <callbackUrl>/payments through relay. */
export const PaymentsWebhook = z.object({
  id: IdSchema,
  paymentRef: IdSchema,
  orderId: IdSchema,
  event: z.enum(["captured", "refunded", "failed"]),
  amount: z.number().int(),
  currency: z.string(),
  atMs: SimMsSchema,
});
export type PaymentsWebhook = z.infer<typeof PaymentsWebhook>;
export type AuthorizeRequest = z.infer<typeof AuthorizeRequest>;
export type PaymentResponse = z.infer<typeof PaymentResponse>;
export { MoneySchema };
