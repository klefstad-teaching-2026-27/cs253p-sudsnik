import Fastify, { type FastifyInstance } from "fastify";
import { SIM_TOKEN_HEADER } from "@sudsnik/contracts";
import { FinishRequestSchema, RunRequestSchema, type Sim } from "./sim.js";

/**
 * system-spec §7.2: /clock, /run, /status, plus /finish for the driver's end-of-run inputs. With a token, /run and
 * /finish require it: the stack shares the loopback and must not be able to start or judge its own run.
 */
export function createServer(sim: Sim, token?: string): FastifyInstance {
  const app = Fastify({ logger: false });
  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0];
    if (token && (path === "/run" || path === "/finish") && req.headers[SIM_TOKEN_HEADER] !== token) {
      return reply.code(403).send({ code: "FORBIDDEN", message: `missing or wrong ${SIM_TOKEN_HEADER}`, retryable: false });
    }
  });

  app.get("/health", async () => ({ ok: true }));
  app.get("/clock", async () => sim.clock());
  app.get("/status", async () => sim.status());

  app.post("/run", async (req, reply) => {
    const parsed = RunRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ code: "INVALID", message: parsed.error.message, retryable: false });
    try {
      const run = sim.run(parsed.data);
      return reply.code(202).send({ scenario: run.scenario.name, scale: run.scale, seed: run.seed, startMs: run.startMs, faults: run.faults });
    } catch (e) {
      return reply.code(409).send({ code: "CONFLICT", message: e instanceof Error ? e.message : String(e), retryable: false });
    }
  });

  app.post("/finish", async (req, reply) => {
    const parsed = FinishRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ code: "INVALID", message: parsed.error.message, retryable: false });
    try {
      return sim.finish(parsed.data);
    } catch (e) {
      return reply.code(409).send({ code: "CONFLICT", message: e instanceof Error ? e.message : String(e), retryable: false });
    }
  });

  return app;
}
