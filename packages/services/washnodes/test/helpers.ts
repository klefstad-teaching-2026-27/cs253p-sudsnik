import { HOLD_TTL_MS, IDEMPOTENCY_HEADER, TENANT_HEADER, makeEnvelope, type Ctx, type Envelope, type PayloadOf, type Topic } from "@sudsnik/contracts";
import type { CycleResponse, WasherCallback } from "@sudsnik/contracts/mocks/washer-v2";
import type { StatusResponse } from "@sudsnik/contracts/mocks/washer-v1";
import type { Hold, NodeStatus } from "@sudsnik/contracts/services/washnodes";
import { fakeDeps, type FakeDeps } from "@sudsnik/contracts/testing";
import type { LegacyMethod, WashnodesRpc } from "@sudsnik/clients/legacy/washnodesRpc";
import { err, ok, sudsnikError, type Result, type SudsnikError } from "@sudsnik/kernel";
import type { AppOptions, Profile, WashnodesApp } from "../src/app/compose.js";
// The selector, so this helper works in any tree: the starter ships one variant and `src/index.ts` names it (§8).
import * as selected from "../src/index.js";

export const SEED = "00000000c0ffee00";

export interface Variant {
  name: string;
  handlersDir: string;
  /** The storage the variant brings; the shared app names no variant of its own (`docs/system-spec.md` §8). */
  profile: Profile;
  createApp(deps: FakeDeps, opts?: AppOptions): Promise<WashnodesApp>;
}

/** The variant this tree selects, which is the only one the starter has. */
export const SELECTED: Variant = { name: selected.variant, handlersDir: selected.handlersDir, profile: selected.profile, createApp: selected.createApp };

type Outcome = { state: "running" } | { state: "completed"; cycleUnits: number } | { state: "faulted"; faultCode: string };

interface FakeCycle {
  cycleId: string;
  washerId: string;
  startedAt: number;
  outcome: Outcome;
}

/**
 * Both washer firmware generations in memory, answering as the mocks do. `complete` and `fault` settle a cycle so
 * that the next status poll, `GET /cycles/:id`, or a callback the test posts reports it.
 */
export interface FakeFirmware {
  rpc: WashnodesRpc;
  calls: string[];
  cycles: Map<string, FakeCycle>;
  holdsByRef: Map<string, string>;
  complete(cycleId: string, cycleUnits?: number): void;
  fault(cycleId: string, faultCode?: string): void;
  /** Fails the next call of these operations with the error; the queue drains one entry per call. */
  failNext(op: string, error: SudsnikError): void;
  /** The callback body washer-v2 would deliver for a settled cycle. */
  callbackFor(cycleId: string, id?: string): WasherCallback;
  lastCycleId(): string;
}

export function fakeFirmware(deps: FakeDeps): FakeFirmware {
  let n = 0;
  const next = (p: string) => `${p}${++n}`;
  const calls: string[] = [];
  const cycles = new Map<string, FakeCycle>();
  const holdsByRef = new Map<string, string>();
  const cycleByWasher = new Map<string, string>();
  const failures = new Map<string, SudsnikError[]>();
  const fail = <T>(op: string): Result<T> | undefined => {
    const e = failures.get(op)?.shift();
    return e ? err(e) : undefined;
  };
  /** Every firmware call yields to the event loop once, as a real HTTP round trip would, so concurrent callers interleave. */
  const record = async <T>(op: string, arg: string, fn: () => Result<T>): Promise<Result<T>> => {
    calls.push(`${op}:${arg}`);
    await new Promise((r) => setImmediate(r));
    return fail<T>(op) ?? fn();
  };
  const startOn = (washerId: string): FakeCycle => {
    const c: FakeCycle = { cycleId: next("cyc"), washerId, startedAt: deps.clock.now(), outcome: { state: "running" } };
    cycles.set(c.cycleId, c);
    cycleByWasher.set(washerId, c.cycleId);
    return c;
  };
  const view = (c: FakeCycle): CycleResponse => ({
    cycleId: c.cycleId,
    washerId: c.washerId,
    state: c.outcome.state,
    startedAtMs: c.startedAt,
    endsAtMs: c.startedAt + 45 * 60_000,
    ...(c.outcome.state === "completed" ? { cycleUnits: c.outcome.cycleUnits } : {}),
    ...(c.outcome.state === "faulted" ? { faultCode: c.outcome.faultCode } : {}),
  });
  const v1Status = (washer: string): StatusResponse => {
    const c = cycles.get(cycleByWasher.get(washer) ?? "");
    if (!c) return { washer, state: "idle" };
    if (c.outcome.state === "running") return { washer, state: "washing", cycleId: c.cycleId };
    if (c.outcome.state === "completed") return { washer, state: "done", cycleId: c.cycleId, cycleUnits: c.outcome.cycleUnits };
    return { washer, state: "faulted", cycleId: c.cycleId, faultCode: c.outcome.faultCode };
  };

  deps.clients.washerV1 = {
    hold: () => Promise.resolve(err(sudsnikError("INTERNAL", "v1 hold must go through the legacy rpc"))),
    status: () => Promise.resolve(err(sudsnikError("INTERNAL", "v1 status must go through the legacy rpc"))),
    start: (washer, holdToken) =>
      record("v1.start", washer, () => {
        if (holdsByRef.get(holdToken) !== washer) return err(sudsnikError("CONFLICT", "no active hold for that token"));
        holdsByRef.delete(holdToken);
        const c = startOn(washer);
        return ok({ cycleId: c.cycleId, startedAtMs: c.startedAt });
      }),
    release: (washer, holdToken) => record("v1.release", washer, () => (holdsByRef.delete(holdToken), ok(undefined))),
  };
  deps.clients.washerV2 = {
    createHold: (washerId) =>
      record("v2.createHold", washerId, () => {
        const holdId = next("h2-");
        holdsByRef.set(holdId, washerId);
        return ok({ holdId, washerId, expiresAtMs: deps.clock.now() + HOLD_TTL_MS });
      }),
    deleteHold: (holdId) => record("v2.deleteHold", holdId, () => (holdsByRef.delete(holdId) ? ok(undefined) : err(sudsnikError("NOT_FOUND", `no hold ${holdId}`)))),
    startCycle: (holdId, callbackUrl) =>
      record("v2.startCycle", `${holdId}@${callbackUrl}`, () => {
        const washerId = holdsByRef.get(holdId);
        if (!washerId) return err(sudsnikError("NOT_FOUND", `no hold ${holdId}`));
        holdsByRef.delete(holdId);
        return ok(view(startOn(washerId)));
      }),
    cycle: (cycleId) =>
      record("v2.cycle", cycleId, () => {
        const c = cycles.get(cycleId);
        return c ? ok(view(c)) : err(sudsnikError("NOT_FOUND", `no cycle ${cycleId}`));
      }),
  };
  const rpc: WashnodesRpc = {
    invoke: <T>(method: LegacyMethod, params: Record<string, string>, _ctx: Ctx) =>
      record<T>(`rpc.${method}`, params.washer ?? "", () => {
        const washer = params.washer ?? "";
        if (method === "MachineHold") {
          const holdToken = next("tok");
          holdsByRef.set(holdToken, washer);
          return ok({ holdToken, washer, expiresAtMs: deps.clock.now() + HOLD_TTL_MS } as T);
        }
        if (method === "MachineStatus") return ok(v1Status(washer) as T);
        return err(sudsnikError("INVALID", `legacy ${method} is not part of the v1 adapter path`));
      }),
  };
  const settle = (cycleId: string, outcome: Outcome) => {
    const c = cycles.get(cycleId);
    if (!c) throw new Error(`no fake cycle ${cycleId}`);
    c.outcome = outcome;
  };
  return {
    rpc,
    calls,
    cycles,
    holdsByRef,
    complete: (cycleId, cycleUnits = 37) => settle(cycleId, { state: "completed", cycleUnits }),
    fault: (cycleId, faultCode = "E11_DRUM_STALL") => settle(cycleId, { state: "faulted", faultCode }),
    failNext: (op, error) => failures.set(op, [...(failures.get(op) ?? []), error]),
    callbackFor(cycleId, id = next("wcb")) {
      const c = cycles.get(cycleId);
      if (!c || c.outcome.state === "running") throw new Error(`cycle ${cycleId} has not settled`);
      return {
        id,
        cycleId,
        washerId: c.washerId,
        state: c.outcome.state,
        atMs: deps.clock.now(),
        ...(c.outcome.state === "completed" ? { cycleUnits: c.outcome.cycleUnits } : { faultCode: c.outcome.faultCode }),
      };
    },
    lastCycleId: () => [...cycles.keys()].at(-1)!,
  };
}

export interface Response<T> {
  status: number;
  body: T;
}

export interface Harness {
  app: WashnodesApp;
  deps: FakeDeps;
  fw: FakeFirmware;
  acquire(nodeId: string, orderId: string, tenant?: string): Promise<Response<Hold>>;
  release(holdId: string, reason?: string, tenant?: string): Promise<Response<Hold>>;
  start(holdId: string, tenant?: string): Promise<Response<{ cycleId: string; washerId: string; startedAt: number }>>;
  status(nodeId: string, tenant?: string): Promise<Response<NodeStatus>>;
  callback(body: WasherCallback): Promise<Response<{ accepted: boolean; duplicate: boolean }>>;
  /** Moves the outbox to the fake bus and returns every published envelope of the topic. */
  events<T extends Topic>(topic: T): Promise<Envelope<PayloadOf<T>>[]>;
  /** Advances the simulated clock, which fires every due sweep, poll, and reconciliation. */
  advance(ms: number): Promise<void>;
  deliver<T extends Topic>(topic: T, payload: PayloadOf<T>, tenant?: string): Promise<Result<void>[]>;
  /** Acquires a hold and delivers the pod to it, which starts the cycle; the firmware cycle id comes back with it. */
  wash(nodeId: string, orderId: string, tenant?: string): Promise<{ hold: Hold; podId: string; cycleId: string; washerId: string }>;
  close(): Promise<void>;
}

let keyCounter = 0;

export async function harness(variant: Variant, seed = SEED, dataDir?: string): Promise<Harness> {
  const deps = fakeDeps(seed, "washnodes", { handlersDir: variant.handlersDir, ...(dataDir ? { dataDir } : {}) });
  const fw = fakeFirmware(deps);
  const app = await variant.createApp(deps, { v1Rpc: fw.rpc });
  const headers = (tenant: string) => ({ [TENANT_HEADER]: tenant, [IDEMPOTENCY_HEADER]: `k${++keyCounter}` });
  const call = async <T>(method: "GET" | "POST", url: string, tenant: string, payload?: unknown): Promise<Response<T>> => {
    const res = await app.inject({ method, url, headers: headers(tenant), payload: payload as Record<string, unknown> | undefined });
    return { status: res.statusCode, body: res.json() as T };
  };
  const settleTimers = async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
  };
  const h: Harness = {
    app,
    deps,
    fw,
    acquire: (nodeId, orderId, tenant = "op1") => call("POST", "/holds", tenant, { nodeId, orderId }),
    release: (holdId, reason = "test", tenant = "op1") => call("POST", `/holds/${holdId}/release`, tenant, { reason }),
    start: (holdId, tenant = "op1") => call("POST", `/holds/${holdId}/start`, tenant, {}),
    status: (nodeId, tenant = "op1") => call("GET", `/nodes/${nodeId}`, tenant),
    callback: async (body) => {
      const res = await app.inject({ method: "POST", url: "/callbacks/washer", payload: body });
      await settleTimers();
      return { status: res.statusCode, body: res.json() as { accepted: boolean; duplicate: boolean } };
    },
    events: async (topic) => {
      await app.washnodes.outbox.pump();
      return deps.bus.ofTopic(topic);
    },
    advance: async (ms) => {
      deps.clock.advanceTo(deps.clock.now() + ms);
      await settleTimers();
    },
    deliver: (topic, payload, tenant = "op1") => deps.bus.deliver(makeEnvelope({ topic, tenantId: tenant, occurredAt: deps.clock.now(), payload })),
    wash: async (nodeId, orderId, tenant = "op1") => {
      const hold = await h.acquire(nodeId, orderId, tenant);
      if (hold.status !== 201) throw new Error(`acquire -> ${hold.status} ${JSON.stringify(hold.body)}`);
      const podId = `pod-of-${orderId}`;
      const results = await h.deliver("pod.delivered", { orderId, podId, nodeId, holdId: hold.body.holdId, deliveredAt: deps.clock.now() }, tenant);
      if (!results.every((r) => r.ok)) throw new Error(`pod.delivered -> ${JSON.stringify(results)}`);
      const cycleId = fw.lastCycleId();
      return { hold: hold.body, podId, cycleId, washerId: fw.cycles.get(cycleId)!.washerId };
    },
    close: () => app.sudsnik.drain(),
  };
  return h;
}
