import { createHash } from "node:crypto";
import { TENANT_HEADER, makeEnvelope, type ServiceDeps, type Topic } from "@sudsnik/contracts";
import type { RelayCallback } from "@sudsnik/contracts/mocks/relay";
import { fakeDeps, ok, type FakeDeps } from "@sudsnik/contracts/testing";
import { handlersDir } from "../src/index.js";

export const SEED = "00000000c0ffee00";
export const tenant = (t = "op1") => ({ [TENANT_HEADER]: t });

export function deps(): FakeDeps {
  return fakeDeps(SEED, "tracking", { handlersDir });
}

/** Canonical JSON as `docs/system-spec.md` §10.3 defines it, written here rather than taken from the service. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * A relay position callback whose checksum is computed from the specification rather than from the service, so a
 * service that drifted from what the simulator writes fails here instead of silently rejecting every callback.
 */
export function positionCallback(shuttleId: string, orbitPhase: number, atMs: number, id = `${shuttleId}-${atMs}`): RelayCallback {
  const body = { kind: "position" as const, id, shuttleId, orbitPhase, atMs };
  return { ...body, checksum: createHash("sha256").update(canonical(body)).digest("hex").slice(0, 8) };
}

/** Points the fake `ephemeris.position` at a fixed answer and counts the calls. */
export function fakeEphemeris(d: ServiceDeps, orbitPhase = 0.25, atMs = 1_000): { calls: number } {
  const counter = { calls: 0 };
  d.clients.ephemeris.position = async (shuttleId) => {
    counter.calls++;
    return ok({ shuttleId, orbitPhase, atMs });
  };
  return counter;
}

export const event = (d: FakeDeps, topic: Topic, payload: unknown, occurredAt = 0, tenantId = "op1") => d.bus.deliver(makeEnvelope({ topic, tenantId, occurredAt, payload }));
