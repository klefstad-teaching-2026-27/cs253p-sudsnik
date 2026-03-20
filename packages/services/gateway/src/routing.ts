import { SERVICES, serviceUrlVar, type ServiceDeps, type Service } from "@sudsnik/contracts";
import { API_VERSIONS, RESOURCE_PREFIXED, type GatewayRoutes } from "@sudsnik/contracts/services/gateway";

export type ApiVersion = (typeof API_VERSIONS)[number];
export type Upstream = Exclude<Service, "gateway">;

/**
 * What a version segment prepends to the upstream path, for a service that serves more than one surface. Which
 * surfaces exist is the variant's to say, so each variant supplies this rather than the table naming a module
 * every tree would then have to carry (`docs/system-spec.md` §8, rule 7).
 */
export type VersionPrefix = (version: ApiVersion, service: Upstream) => string;

export interface Route {
  version: ApiVersion;
  service: Upstream;
  baseUrl: string;
  deprecated: boolean;
}

export interface RoutingTable extends GatewayRoutes {
  resolve(version: string, service: string): Route | undefined;
  /** True for every /v1 path once api.v2 is on, whether or not the path resolves. */
  deprecated(version: string): boolean;
  enabled(service: Upstream): boolean;
  /** Absolute upstream URL for the public path's remainder (`/abc?x=1` or empty), version prefix included. */
  upstreamUrl(route: Route, rest: string): string;
}

export const isApiVersion = (s: string): s is ApiVersion => (API_VERSIONS as readonly string[]).includes(s);
export const isUpstream = (s: string): s is Upstream => s !== "gateway" && (SERVICES as readonly string[]).includes(s);

/** What `/v1/<service>` prepends to the upstream path, from the catalogue in the gateway's own contract. */
export const resourcePrefix = (service: Upstream): string => (RESOURCE_PREFIXED.includes(service) ? `/${service}` : "");

export const createRoutingTable = (deps: Pick<ServiceDeps, "env" | "flags">, versionPrefix: VersionPrefix): RoutingTable => {
  const baseUrls = Object.fromEntries(
    SERVICES.filter(isUpstream).map((s) => [s, deps.env[serviceUrlVar(s)]?.replace(/\/$/, "")]),
  ) as Record<Upstream, string | undefined>;
  const prefixes = Object.fromEntries(SERVICES.filter(isUpstream).map((s) => [s, resourcePrefix(s)])) as Record<Upstream, string>;
  const deprecated = (version: string) => version === "v1" && deps.flags.isOn("api.v2");
  const routeFor = (version: ApiVersion, service: Service): Route | undefined => {
    if (!isUpstream(service)) return undefined;
    const baseUrl = baseUrls[service];
    if (baseUrl === undefined) return undefined;
    return { version, service, baseUrl, deprecated: deprecated(version) };
  };
  return {
    routeFor,
    resolve: (version, service) => (isApiVersion(version) && isUpstream(service) ? routeFor(version, service) : undefined),
    deprecated,
    enabled: (service) => deps.flags.isOn(`${service}.enabled`),
    upstreamUrl: (route, rest) => {
      const path = versionPrefix(route.version, route.service) + prefixes[route.service] + rest;
      return route.baseUrl + (path.startsWith("/") ? path : `/${path}`);
    },
  };
};
