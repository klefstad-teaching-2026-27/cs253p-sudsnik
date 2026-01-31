import type { Result } from "@sudsnik/kernel";
import type { Ctx } from "../../common.js";
import type { Assignment } from "./routes.js";

export interface DispatchService {
  schedulePickup(orderId: string, ctx: Ctx): Promise<Result<Assignment>>;
  scheduleReturn(orderId: string, ctx: Ctx): Promise<Result<Assignment>>;
  reassign(orderId: string, ctx: Ctx): Promise<Result<Assignment>>;
}

/** Shared with notify: accepting a relay callback body idempotently and order-tolerantly. */
export interface RelayIngest<B> {
  accept(body: B, ctx: Ctx): Promise<Result<{ duplicate: boolean }>>;
}
