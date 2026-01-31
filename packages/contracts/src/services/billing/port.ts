import type { Result } from "@sudsnik/kernel";
import type { Ctx } from "../../common.js";
import type { Charge, LedgerEntry, LedgerFilter, Quote } from "./routes.js";

export interface BillingService {
  quote(orderId: string, ctx: Ctx): Promise<Result<Quote>>;
  authorize(orderId: string, amount: number, ctx: Ctx): Promise<Result<Charge>>;
  capture(orderId: string, ctx: Ctx): Promise<Result<Charge>>;
  refund(orderId: string, ctx: Ctx): Promise<Result<Charge>>;
  ledger(filter: LedgerFilter, ctx: Ctx): Promise<Result<LedgerEntry[]>>;
}
