import type { AccountsService } from "@sudsnik/contracts/services/accounts";
import type { App } from "@sudsnik/infra-http";
import { registerCrewRoutes } from "./crews.js";
import { registerHabitatRoutes } from "./habitats.js";
import { registerOperatorRoutes } from "./operators.js";

export function registerRoutes(app: App, service: AccountsService): void {
  registerOperatorRoutes(app, service);
  registerHabitatRoutes(app, service);
  registerCrewRoutes(app, service);
}
