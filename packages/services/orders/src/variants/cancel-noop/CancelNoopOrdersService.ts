import type { Ctx } from "@sudsnik/contracts";
import type { Order } from "@sudsnik/contracts/services/orders";
import type { Result } from "@sudsnik/kernel";
import { OrdersService } from "../../core/OrdersService.js";

/** The starter: cancel answers with the current order and changes, records, and publishes nothing (system-spec §8). */
export class CancelNoopOrdersService extends OrdersService {
  cancel(orderId: string, _reason: string, ctx: Ctx): Promise<Result<Order>> {
    return this.get(orderId, ctx);
  }
}
