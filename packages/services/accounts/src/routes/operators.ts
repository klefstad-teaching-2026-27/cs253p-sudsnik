import { z } from "zod";
import { IdSchema, IdempotencyHeaders } from "@sudsnik/contracts";
import { Operator, OperatorPatch, type AccountsService } from "@sudsnik/contracts/services/accounts";
import { sendResult, type App } from "@sudsnik/infra-http";

const Params = z.object({ operatorId: IdSchema });
/** Every key of OperatorPatch is optional, so a body of unknown keys would otherwise pass as an empty patch. */
const Body = OperatorPatch.strict();

export function registerOperatorRoutes(app: App, service: AccountsService): void {
  app.get("/operators/:operatorId", { schema: { params: Params, response: { 200: Operator } } }, async (req, reply) =>
    sendResult(reply, await service.operator(req.params.operatorId, req.ctx)),
  );
  app.put("/operators/:operatorId", { schema: { headers: IdempotencyHeaders, params: Params, body: Body, response: { 200: Operator } } }, async (req, reply) =>
    sendResult(reply, await service.updateOperator(req.params.operatorId, req.body, req.ctx)),
  );
}
