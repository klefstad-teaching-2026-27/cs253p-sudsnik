import type { Service, ServiceDeps } from "@sudsnik/contracts";
import type { App, SudsnikApp } from "@sudsnik/infra-http";
import type { Result } from "@sudsnik/kernel";

export interface LoadedService {
  service: Service;
  readEnv(): Result<unknown>;
  createApp(deps: ServiceDeps): Promise<App & { sudsnik: SudsnikApp }>;
  start(): Promise<unknown>;
  handlersDir: string;
}

export async function loadService(service: Service): Promise<LoadedService> {
  const mod = (await import(`@sudsnik/service-${service}`)) as Partial<LoadedService>;
  for (const k of ["readEnv", "createApp", "start"] as const) {
    if (typeof mod[k] !== "function") throw new TypeError(`@sudsnik/service-${service} does not export ${k}()`);
  }
  if (typeof mod.handlersDir !== "string") throw new TypeError(`@sudsnik/service-${service} does not export handlersDir`);
  return { ...(mod as LoadedService), service };
}
