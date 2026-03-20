import type { ServiceDeps } from "@sudsnik/contracts";
import { createGatewayApp, type CreateAppOptions, type GatewayApp, type Variant } from "../../app.js";
import { registerForwardRoute } from "../../forward.js";
import { registerOperatorRoute } from "../../operators/route.js";
import { createRoutingTable, type VersionPrefix } from "../../routing.js";
import { createCachedVerifier } from "../../verify.js";

/**
 * No service has migrated, so no version has a second surface to reach: every version of a path lands on the one
 * surface its service serves.
 */
export const oneSurface: VersionPrefix = () => "";

export const v1Only: Variant = {
  name: "v1-only",
  register: (app, { deps, http, store }) => {
    registerForwardRoute(app, { http, table: createRoutingTable(deps, oneSurface), verify: createCachedVerifier(deps) });
    registerOperatorRoute(app, store);
  },
};

export const createApp = (deps: ServiceDeps, opts: CreateAppOptions = {}): Promise<GatewayApp> => createGatewayApp(deps, v1Only, opts);
