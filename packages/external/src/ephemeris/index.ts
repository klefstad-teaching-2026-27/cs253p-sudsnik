import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HABITATS, LINK_WINDOW_MINUTES, MINUTE_MS, NODES, ORBIT_MS, SHUTTLES, WASHERS_PER_NODE, nextWindowStart } from "@sudsnik/contracts";
import { type NodeStatusResponse, type PositionResponse, type WindowsResponse } from "@sudsnik/contracts/mocks/ephemeris";
import { createMockApp, type MockOptions } from "../mock.js";

export const EPHEMERIS_QUOTA_PER_ORBIT = 100;
/** The true TTL; the README documents 60 s (system-spec §11 B5). */
export const STATUS_TTL_MS = 300 * 1000;
export const WINDOWS_AHEAD = 3;

export async function createMock(opts: MockOptions): Promise<FastifyInstance> {
  const mock = await createMockApp("ephemeris", opts);
  const { app } = mock;
  const quota = mock.quota(() => {
    const calls = mock.fault("quota")?.params.callsPerOrbit;
    return typeof calls === "number" ? calls : EPHEMERIS_QUOTA_PER_ORBIT;
  });
  const statusCache = new Map<string, NodeStatusResponse>();

  app.addHook("preHandler", async (req, reply) => {
    if (req.url.startsWith("/_sim/")) return;
    if (!quota.take(req.tenant)) {
      return mock.fail(reply, "QUOTA", `quota of ${EPHEMERIS_QUOTA_PER_ORBIT} calls per orbit spent`, { "retry-after": String(mock.secondsToNextOrbit()) });
    }
  });

  app.get("/windows", { schema: { querystring: z.object({ habitat: z.string() }) } }, async (req, reply) => {
    const habitatId = req.query.habitat;
    if (!HABITATS.includes(habitatId)) return mock.fail(reply, "NOT_FOUND", `no habitat ${habitatId}`);
    const now = mock.nowMs();
    const windows: WindowsResponse["windows"] = [];
    let from = now;
    for (let i = 0; i < WINDOWS_AHEAD; i++) {
      const startMs = nextWindowStart(habitatId, from);
      windows.push({ startMs, endMs: startMs + LINK_WINDOW_MINUTES * MINUTE_MS });
      from = startMs + ORBIT_MS - (startMs % ORBIT_MS);
    }
    const body: WindowsResponse = { habitatId, windows, computedAtMs: now };
    return body;
  });

  app.get("/position", { schema: { querystring: z.object({ shuttle: z.string() }) } }, async (req, reply) => {
    const shuttleId = req.query.shuttle;
    const index = (SHUTTLES as readonly string[]).indexOf(shuttleId);
    if (index < 0) return mock.fail(reply, "NOT_FOUND", `no shuttle ${shuttleId}`);
    const atMs = mock.nowMs();
    const offset = (index / SHUTTLES.length) * ORBIT_MS;
    const body: PositionResponse = { shuttleId, orbitPhase: ((atMs + offset) % ORBIT_MS) / ORBIT_MS, atMs };
    return body;
  });

  app.get("/status", { schema: { querystring: z.object({ node: z.string() }) } }, async (req, reply) => {
    const nodeId = req.query.node;
    if (!(NODES as readonly string[]).includes(nodeId)) return mock.fail(reply, "NOT_FOUND", `no node ${nodeId}`);
    const now = mock.nowMs();
    const cached = statusCache.get(nodeId);
    if (cached && now - cached.cachedAtMs < STATUS_TTL_MS) return cached;
    const fresh: NodeStatusResponse = {
      nodeId,
      inContact: !mock.isDark(nodeId),
      washersFree: mock.rng("status").int(WASHERS_PER_NODE + 1),
      cachedAtMs: now,
    };
    statusCache.set(nodeId, fresh);
    return fresh;
  });

  return app;
}
