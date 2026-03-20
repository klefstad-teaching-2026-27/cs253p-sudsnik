import { z } from "zod";
import { IdSchema } from "@sudsnik/contracts";
import { sendResult, type App } from "@sudsnik/infra-http";
import { err, ok, sudsnikError } from "@sudsnik/kernel";
import { OperatorRoute, type OperatorStore } from "./store.js";

const Params = z.object({ operatorId: IdSchema });

/** GET /operators/:operatorId/route: the routing record the tenant's own operator.updated events built. */
export const registerOperatorRoute = (app: App, store: OperatorStore): void => {
  app.get("/operators/:operatorId/route", { schema: { params: Params, response: { 200: OperatorRoute } } }, async (req, reply) => {
    const record = store.get(req.ctx.tenantId, req.params.operatorId);
    return sendResult(reply, record ? ok(record) : err(sudsnikError("NOT_FOUND", `no route for operator ${req.params.operatorId}`)));
  });
};
