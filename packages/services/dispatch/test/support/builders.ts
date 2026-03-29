import { createHash } from "node:crypto";
import { HOLD_TTL_MS, LINK_WINDOW_MINUTES, MINUTE_MS, ORBIT_MS, makeEnvelope, nextWindowStart, type Envelope, type ServiceDeps } from "@sudsnik/contracts";
import type { NodeStatusResponse, PositionResponse, WindowsResponse } from "@sudsnik/contracts/mocks/ephemeris";
import type { RelayCallback } from "@sudsnik/contracts/mocks/relay";
import type { Hold } from "@sudsnik/contracts/services/washnodes";
import { fakeDeps, ok, type FakeDeps } from "@sudsnik/contracts/testing";
import { newId } from "@sudsnik/kernel";
import { handlersDir } from "../../src/index.js";

export const SEED = "00000000c0ffee00";
export const TENANT = "op1";

export function buildDeps(overrides: Partial<ServiceDeps> = {}): FakeDeps {
  return fakeDeps(SEED, "dispatch", { handlersDir, ...overrides });
}

export interface OrderInput {
  orderId?: string;
  habitatId?: string;
  podId?: string;
  tenantId?: string;
  requestedAt?: number;
}

export function buildOrderPlaced(input: OrderInput = {}): Envelope<{ orderId: string; habitatId: string; podId: string; requestedAt: number }> {
  const orderId = input.orderId ?? `ord-${newId()}`;
  const habitatId = input.habitatId ?? "hab01";
  return makeEnvelope({
    topic: "order.placed",
    tenantId: input.tenantId ?? TENANT,
    occurredAt: input.requestedAt ?? 0,
    payload: { orderId, habitatId, podId: input.podId ?? `${habitatId}-p001`, requestedAt: input.requestedAt ?? 0 },
  });
}

/** `origin` tells a cancellation someone asked for from the compensation `orders` runs when dispatch gives up. */
export function buildOrderCancelled(orderId: string, tenantId = TENANT, origin: "customer" | "system" = "customer") {
  return makeEnvelope({ topic: "order.cancelled", tenantId, occurredAt: 0, payload: { orderId, reason: "test", origin, compensations: [] } });
}

export function buildHoldExpired(hold: { holdId: string; washerId: string; orderId: string }, tenantId = TENANT) {
  return makeEnvelope({ topic: "hold.expired", tenantId, occurredAt: 0, payload: hold });
}

export function buildWashCompleted(orderId: string, washerId = "B3", tenantId = TENANT) {
  return makeEnvelope({ topic: "wash.completed", tenantId, occurredAt: 0, payload: { orderId, washerId, completedAt: 0, cycleUnits: 12 } });
}

export function buildHoldReleased(hold: { holdId: string; washerId: string; orderId: string }, tenantId = TENANT) {
  return makeEnvelope({ topic: "hold.released", tenantId, occurredAt: 0, payload: { ...hold, reason: "test" } });
}

export function buildHold(input: { nodeId: string; orderId: string; nowMs?: number; holdId?: string }): Hold {
  const nowMs = input.nowMs ?? 0;
  return {
    holdId: input.holdId ?? `hold-${newId()}`,
    tenantId: TENANT,
    nodeId: input.nodeId,
    washerId: `${input.nodeId}1`,
    orderId: input.orderId,
    state: "held",
    acquiredAt: nowMs,
    expiresAt: nowMs + HOLD_TTL_MS,
    version: 0,
  };
}

export function buildWindows(habitatId: string, nowMs: number): WindowsResponse {
  const windows: WindowsResponse["windows"] = [];
  let from = nowMs;
  for (let i = 0; i < 3; i++) {
    const startMs = nextWindowStart(habitatId, from);
    windows.push({ startMs, endMs: startMs + LINK_WINDOW_MINUTES * MINUTE_MS });
    from = startMs + ORBIT_MS - (startMs % ORBIT_MS);
  }
  return { habitatId, windows, computedAtMs: nowMs };
}

export function buildStatus(nodeId: string, washersFree: number, inContact = true): NodeStatusResponse {
  return { nodeId, inContact, washersFree, cachedAtMs: 0 };
}

export function buildPosition(shuttleId: string): PositionResponse {
  return { shuttleId, orbitPhase: 0.25, atMs: 0 };
}

/** The fakes a happy path needs: canon windows, every node with a free washer, every hold granted; returns the call log. */
export function stubClients(deps: FakeDeps, opts: { free?: Record<string, number> } = {}) {
  const calls = { windows: 0, status: 0, position: 0, acquireHold: [] as string[], releaseHold: [] as string[] };
  const free = opts.free ?? { A: 3, B: 5, C: 5 };
  deps.clients.ephemeris.windows = async (habitatId) => {
    calls.windows++;
    return ok(buildWindows(habitatId, deps.clock.now()));
  };
  deps.clients.ephemeris.status = async (nodeId) => {
    calls.status++;
    return ok(buildStatus(nodeId, free[nodeId] ?? 0));
  };
  deps.clients.ephemeris.position = async (shuttleId) => {
    calls.position++;
    return ok(buildPosition(shuttleId));
  };
  deps.clients.washnodes.acquireHold = async (nodeId, orderId) => {
    calls.acquireHold.push(nodeId);
    return ok(buildHold({ nodeId, orderId, nowMs: deps.clock.now() }));
  };
  deps.clients.washnodes.releaseHold = async (holdId) => {
    calls.releaseHold.push(holdId);
    return ok({ ...buildHold({ nodeId: "B", orderId: "x", holdId }), state: "released" });
  };
  return calls;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** A relay callback body with a checksum computed the way system-spec §10.3 says, independently of the service. */
export function buildCallback<K extends RelayCallback["kind"]>(kind: K, fields: Omit<Extract<RelayCallback, { kind: K }>, "kind" | "id" | "atMs" | "checksum"> & { id?: string; atMs?: number }): Extract<RelayCallback, { kind: K }> {
  const body = { kind, id: fields.id ?? newId(), atMs: fields.atMs ?? 0, ...fields } as Record<string, unknown>;
  const checksum = createHash("sha256").update(canonical(body)).digest("hex").slice(0, 8);
  return { ...body, checksum } as Extract<RelayCallback, { kind: K }>;
}

export function relayHeaders(tenantId = TENANT): Record<string, string> {
  return { "x-sudsnik-tenant": tenantId };
}

export function writeHeaders(key: string, tenantId = TENANT): Record<string, string> {
  return { "x-sudsnik-tenant": tenantId, "idempotency-key": key };
}
