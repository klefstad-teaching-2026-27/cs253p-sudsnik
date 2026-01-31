import type { Result } from "@sudsnik/kernel";
import type { Ctx } from "../../common.js";
import type { Order, OrderFilter, PlaceOrder } from "./routes.js";

export interface OrdersService {
  place(cmd: PlaceOrder, ctx: Ctx): Promise<Result<Order>>;
  cancel(orderId: string, reason: string, ctx: Ctx): Promise<Result<Order>>;
  get(orderId: string, ctx: Ctx): Promise<Result<Order>>;
  list(filter: OrderFilter, ctx: Ctx): Promise<Result<Order[]>>;
}
