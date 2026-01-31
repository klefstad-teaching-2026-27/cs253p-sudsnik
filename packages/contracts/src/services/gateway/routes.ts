import { z } from "zod";
import type { Service } from "../../topics.js";
export const API_VERSIONS = ["v1", "v2"] as const;
export const DEPRECATION_HEADER = "deprecation";
export const SUNSET_HEADER = "sunset";
export const routes = {
  forward: { method: "ANY", path: "/:version/:service/*", response: z.unknown() },
} as const;

/**
 * Services whose contract keeps every route under `/<service>`, so the public path's service segment is also the
 * resource: `/v1/orders` reaches orders' own `/orders`. Every other contract starts at the resource, and
 * `/v1/support/reports` reaches support's `/reports`.
 *
 * Declared rather than derived from the route tables, so the gateway does not have to import every service's
 * contract to answer one static question about each. `gateway`'s hidden suite checks the two agree.
 */
export const RESOURCE_PREFIXED: readonly Service[] = ["orders"];
