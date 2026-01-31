import type { Result } from "@sudsnik/kernel";
import type { Ctx } from "../../common.js";
import type { Crew, Habitat, Operator, OperatorPatch } from "./routes.js";

export interface AccountsService {
  operator(operatorId: string, ctx: Ctx): Promise<Result<Operator>>;
  habitat(habitatId: string, ctx: Ctx): Promise<Result<Habitat>>;
  crew(habitatId: string, ctx: Ctx): Promise<Result<Crew[]>>;
  updateOperator(operatorId: string, patch: OperatorPatch, ctx: Ctx): Promise<Result<Operator>>;
}
