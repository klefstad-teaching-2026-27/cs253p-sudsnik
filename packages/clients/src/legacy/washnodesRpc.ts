import type { Ctx } from "@sudsnik/contracts";
import { err, sudsnikError, type Result } from "@sudsnik/kernel";
import type { HttpClient } from "../http.js";

/**
 * Legacy RPC shim from the first washer generation: one `invoke(method, params)` over washer-v1's
 * REST routes. Only the v1 adapter path in washnodes still calls it; v2 uses WasherV2Client.
 */
export type LegacyMethod = "MachineHold" | "MachineStatus" | "MachineStart" | "MachineRelease";

const ROUTES: Record<LegacyMethod, { method: "GET" | "POST"; path: (p: Record<string, string>) => string; body: boolean }> = {
  MachineHold: { method: "POST", path: () => "/hold", body: true },
  MachineStatus: { method: "GET", path: (p) => `/status/${encodeURIComponent(p.washer ?? "")}`, body: false },
  MachineStart: { method: "POST", path: () => "/start", body: true },
  MachineRelease: { method: "POST", path: () => "/release", body: true },
};

export interface WashnodesRpc {
  invoke<T = unknown>(method: LegacyMethod, params: Record<string, string>, ctx: Ctx): Promise<Result<T>>;
}

export function createWashnodesRpc(http: HttpClient, base: string): WashnodesRpc {
  return {
    async invoke<T>(method: LegacyMethod, params: Record<string, string>, ctx: Ctx): Promise<Result<T>> {
      const route = ROUTES[method];
      if (!route) return err(sudsnikError("INVALID", `unknown legacy method ${method}`));
      return http.json<T>({ method: route.method, url: base + route.path(params), kind: "external", ctx, body: route.body ? params : undefined });
    },
  };
}
