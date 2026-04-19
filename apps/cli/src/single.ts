import Fastify, { type FastifyInstance } from "fastify";
import { SERVICES, type Service, type VersionResponse } from "@sudsnik/contracts";
import { createProcessContext, depsFor, type ProcessContext } from "@sudsnik/infra-boot";
import type { App, SudsnikApp } from "@sudsnik/infra-http";
import { loadService, type LoadedService } from "./services.js";

export interface SingleStack {
  root: FastifyInstance;
  ctx: ProcessContext;
  apps: Map<Service, App & { sudsnik: SudsnikApp }>;
  listen(port: number): Promise<number>;
  drain(): Promise<void>;
}

/**
 * One Fastify server hosting every enabled service at /<service>/; each service app is built by its own
 * createApp(deps) and reached through inject, so it never listens and keeps its own routes and hooks.
 */
export async function createSingleStack(env: Record<string, string>, load: (s: Service) => Promise<LoadedService> = loadService): Promise<SingleStack> {
  const ctx = createProcessContext(env);
  const apps = new Map<Service, App & { sudsnik: SudsnikApp }>();
  const mounted: Service[] = [];
  for (const service of SERVICES) {
    if (service !== "gateway" && !ctx.flags.isOn(`${service}.enabled`)) continue;
    const mod = await load(service);
    const deps = depsFor(ctx, service, { handlersDir: mod.handlersDir });
    apps.set(service, await mod.createApp(deps));
    mounted.push(service);
  }
  const root = Fastify();
  root.removeAllContentTypeParsers();
  root.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  root.get("/health", async () => ({ ok: true, services: mounted }));
  root.get("/ready", async (_req, reply) => {
    const states = await Promise.all(mounted.map(async (s) => ({ service: s, ready: (await apps.get(s)!.inject("/ready")).statusCode === 200 })));
    const ready = states.every((x) => x.ready);
    return reply.code(ready ? 200 : 503).send({ ready, services: states });
  });
  root.get("/cost", async (req, reply) => {
    const out = [];
    for (const s of mounted) {
      const r = await apps.get(s)!.inject({ url: "/cost", headers: req.headers as Record<string, string> });
      if (r.statusCode !== 200) return reply.code(r.statusCode).send(r.json());
      out.push(r.json());
    }
    return out;
  });
  root.get("/version", async () => {
    const out: VersionResponse[] = [];
    for (const s of mounted) out.push((await apps.get(s)!.inject("/version")).json() as VersionResponse);
    return out;
  });
  root.route({
    method: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
    url: "/:service/*",
    handler: async (req, reply) => {
      const { service } = req.params as { service: string; "*": string };
      const app = apps.get(service as Service);
      if (!app) return reply.code(404).send({ code: "NOT_FOUND", message: `no service ${service}`, retryable: false });
      const rest = req.url.slice(service.length + 1);
      const headers = { ...req.headers } as Record<string, string>;
      delete headers["content-length"];
      const res = await app.inject({
        method: req.method as "GET",
        url: rest === "" ? "/" : rest,
        headers,
        payload: req.body as Buffer | undefined,
      });
      const outHeaders = { ...res.headers } as Record<string, string | number | string[] | undefined>;
      delete outHeaders["content-length"];
      delete outHeaders["transfer-encoding"];
      delete outHeaders["connection"];
      return reply.code(res.statusCode).headers(outHeaders as Record<string, string>).send(res.rawPayload);
    },
  });
  return {
    root,
    ctx,
    apps,
    async listen(port) {
      await root.listen({ port, host: "127.0.0.1" });
      const a = root.server.address();
      return typeof a === "object" && a ? a.port : port;
    },
    async drain() {
      await root.close();
      for (const s of [...mounted].reverse()) await apps.get(s)!.sudsnik.drain();
      await ctx.close();
    },
  };
}
