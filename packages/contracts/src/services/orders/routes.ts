import { z } from "zod";
import { IdSchema, SimMsSchema } from "../../common.js";

export const ORDER_STATES = ["placed", "scheduled", "collected", "delivered", "washing", "washed", "returning", "returned", "cancelled"] as const;
export const OrderState = z.enum(ORDER_STATES);
export type OrderState = z.infer<typeof OrderState>;
export const TERMINAL_STATES: readonly OrderState[] = ["returned", "cancelled"];
export const CANCELLABLE_STATES: readonly OrderState[] = ["placed", "scheduled", "collected", "delivered"];

export const PaymentState = z.enum(["pending", "authorized", "captured", "failed", "refunded"]);
export type PaymentState = z.infer<typeof PaymentState>;

export const PlaceOrder = z.object({ habitatId: IdSchema, podId: IdSchema, notes: z.string().max(500).optional() });
export type PlaceOrder = z.infer<typeof PlaceOrder>;

export const Order = z.object({
  orderId: IdSchema,
  tenantId: IdSchema,
  habitatId: IdSchema,
  podId: IdSchema,
  state: OrderState,
  payment: PaymentState,
  placedAt: SimMsSchema,
  updatedAt: SimMsSchema,
  shuttleId: IdSchema.optional(),
  nodeId: IdSchema.optional(),
  holdId: IdSchema.optional(),
  returnedAt: SimMsSchema.optional(),
  orbitsElapsed: z.number().nonnegative().optional(),
  cancelReason: z.string().optional(),
  notes: z.string().optional(),
});
export type Order = z.infer<typeof Order>;

export const OrderFilter = z.object({
  state: OrderState.optional(),
  habitatId: IdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: IdSchema.optional(),
});
export type OrderFilter = z.infer<typeof OrderFilter>;

export const CancelRequest = z.object({ reason: z.string().min(1).max(200) });

export const routes = {
  place: { method: "POST", path: "/orders", body: PlaceOrder, response: Order, idempotent: true },
  cancel: { method: "POST", path: "/orders/:orderId/cancel", body: CancelRequest, response: Order, idempotent: true },
  get: { method: "GET", path: "/orders/:orderId", response: Order },
  list: { method: "GET", path: "/orders", query: OrderFilter, response: z.array(Order) },
} as const;
