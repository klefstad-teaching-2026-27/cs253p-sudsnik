import { z } from "zod";
import { IdSchema } from "@sudsnik/contracts";
import { Crew, type AccountsService } from "@sudsnik/contracts/services/accounts";
import { sendResult, type App } from "@sudsnik/infra-http";

const Params = z.object({ habitatId: IdSchema });

export function registerCrewRoutes(app: App, service: AccountsService): void {
  app.get("/habitats/:habitatId/crew", { schema: { params: Params, response: { 200: z.array(Crew) } } }, async (req, reply) =>
    sendResult(reply, await service.crew(req.params.habitatId, req.ctx)),
  );
}
