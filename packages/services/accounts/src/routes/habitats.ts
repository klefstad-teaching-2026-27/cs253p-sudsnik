import { z } from "zod";
import { IdSchema } from "@sudsnik/contracts";
import { Habitat, type AccountsService } from "@sudsnik/contracts/services/accounts";
import { sendResult, type App } from "@sudsnik/infra-http";

const Params = z.object({ habitatId: IdSchema });

export function registerHabitatRoutes(app: App, service: AccountsService): void {
  app.get("/habitats/:habitatId", { schema: { params: Params, response: { 200: Habitat } } }, async (req, reply) =>
    sendResult(reply, await service.habitat(req.params.habitatId, req.ctx)),
  );
}
