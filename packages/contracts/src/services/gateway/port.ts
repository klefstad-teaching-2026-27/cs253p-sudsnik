import type { Service } from "../../topics.js";

/** The gateway has no domain port; it forwards /v1/<service>/<rest> and /v2/<service>/<rest>. */
export interface GatewayRoutes {
  routeFor(version: "v1" | "v2", service: Service): { baseUrl: string; deprecated: boolean } | undefined;
}
