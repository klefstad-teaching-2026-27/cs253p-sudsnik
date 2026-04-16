import {
  MINUTE_MS,
  ORBIT_MS,
  SHUTTLES,
  SHUTTLE_CAPACITY,
  isHabitatVisible,
  nextWindowStart,
  type Envelope,
  type PayloadOf,
} from "@sudsnik/contracts";
import type { DeliverRequest, Endpoint, RelayCallback } from "@sudsnik/contracts/mocks/relay";
import { newId } from "@sudsnik/kernel";
import { checksumOf } from "./checksum.js";
import { OrderMirror, type OrderRecord } from "./orders.js";

export const POSITION_EVERY_MS = 5 * MINUTE_MS;
export const RELAY_CALLBACK_PATH = "/callbacks/relay";
export type PodLocation = { kind: "habitat"; id: string } | { kind: "shuttle"; id: string } | { kind: "node"; id: string };

export interface ShuttleState {
  shuttleId: string;
  /** Orbit phase offset so the fleet is spread around the orbit; position = (nowMs / ORBIT_MS + offset) mod 1. */
  phaseOffset: number;
  route: "idle" | "to-node" | "to-habitat";
  etaMs?: number;
  pods: string[];
}

interface PendingPickup {
  orderId: string;
  shuttleId: string;
  nodeId: string;
  windowStart: number;
  windowEnd: number;
}

interface Transit {
  orderId: string;
  podId: string;
  shuttleId: string;
  habitatId: string;
  nodeId: string;
  arriveAt: number;
}

interface PendingReturn {
  orderId: string;
  shuttleId: string;
  windowStart: number;
}

export interface WorldDeps {
  deliver: (req: DeliverRequest) => Promise<boolean>;
  urls: { dispatch: string; tracking: string };
}

export interface WorldNotes {
  /** Pickups whose window closed before the pod could be collected. */
  missedPickups: number;
  /** pickup.scheduled events without a nodeId; the schema forbids it, so a non-zero count is a contract defect. */
  pickupsWithoutNode: number;
  /** Relay refusals or transport errors, each retried the next minute. */
  deliveryRetries: number;
  /** Events the world could not act on: unknown order, pod not where the action needs it. */
  ignoredEvents: number;
}

export interface WorldSnapshot {
  pods: Record<string, PodLocation>;
  shuttles: ShuttleState[];
  ordersByState: Record<string, number>;
  pendingPickups: number;
  inTransit: number;
  pendingReturns: number;
  pendingDeliveries: number;
  malformedEvents: Record<string, number>;
  notes: WorldNotes;
}

export interface World {
  readonly mirror: OrderMirror;
  /** Feeds bus events in stream order; the world reacts to them on the next step. */
  observe(envelopes: readonly Envelope[]): void;
  /** Runs one simulated minute of physical flow at nowMs; dark lists ids under a dark fault. */
  step(nowMs: number, dark: readonly string[]): Promise<void>;
  snapshot(): WorldSnapshot;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type CallbackFields = DistributiveOmit<RelayCallback, "id" | "atMs" | "checksum">;

export function relayCallback(fields: CallbackFields, atMs: number): RelayCallback {
  const body = { ...fields, id: newId(), atMs };
  return { ...body, checksum: checksumOf(body) } as RelayCallback;
}

/**
 * The physical model of system-spec §10.3: pods, shuttles, and nodes reacting to what the services publish, with
 * every physical fact delivered to the ground through relay.
 */
export function createWorld(deps: WorldDeps): World {
  const mirror = new OrderMirror();
  const pods = new Map<string, PodLocation>();
  const shuttles = new Map<string, ShuttleState>(
    SHUTTLES.map((id, i) => [id, { shuttleId: id, phaseOffset: i / SHUTTLES.length, route: "idle", pods: [] }]),
  );
  const pendingPickups: PendingPickup[] = [];
  const outbound: Transit[] = [];
  const pendingReturns: PendingReturn[] = [];
  const inbound: Transit[] = [];
  const pendingDeliveries: DeliverRequest[] = [];
  const notes: WorldNotes = { missedPickups: 0, pickupsWithoutNode: 0, deliveryRetries: 0, ignoredEvents: 0 };

  function podLocation(o: OrderRecord): PodLocation | undefined {
    if (!o.podId) return undefined;
    const known = pods.get(o.podId);
    if (known) return known;
    if (!o.habitatId) return undefined;
    const home: PodLocation = { kind: "habitat", id: o.habitatId };
    pods.set(o.podId, home);
    return home;
  }

  function queueCallback(origin: Endpoint, destination: "dispatch" | "tracking", fields: CallbackFields, atMs: number): void {
    pendingDeliveries.push({
      origin,
      destination: { kind: "ground", id: destination },
      to: deps.urls[destination],
      path: RELAY_CALLBACK_PATH,
      body: relayCallback(fields, atMs),
      deliverAtMs: atMs,
    });
  }

  function shuttleOf(id: string): ShuttleState {
    let s = shuttles.get(id);
    if (!s) {
      s = { shuttleId: id, phaseOffset: 0, route: "idle", pods: [] };
      shuttles.set(id, s);
    }
    return s;
  }

  function orbitPhaseOf(s: ShuttleState, nowMs: number): number {
    return (nowMs / ORBIT_MS + s.phaseOffset) % 1;
  }

  function collectPickups(nowMs: number, dark: readonly string[]): void {
    for (let i = pendingPickups.length - 1; i >= 0; i--) {
      const p = pendingPickups[i]!;
      if (nowMs < p.windowStart) continue;
      if (nowMs > p.windowEnd) {
        pendingPickups.splice(i, 1);
        notes.missedPickups++;
        continue;
      }
      const o = mirror.orders.get(p.orderId);
      const at = o && podLocation(o);
      if (!o || !o.podId || !o.habitatId || !at) continue;
      if (o.state === "cancelled") {
        pendingPickups.splice(i, 1);
        continue;
      }
      if (at.kind !== "habitat" || at.id !== o.habitatId) {
        pendingPickups.splice(i, 1);
        notes.ignoredEvents++;
        continue;
      }
      if (!isHabitatVisible(o.habitatId, nowMs) || dark.includes(o.habitatId)) continue;
      const s = shuttleOf(p.shuttleId);
      if (s.pods.length >= SHUTTLE_CAPACITY) continue;
      pendingPickups.splice(i, 1);
      s.pods.push(o.podId);
      s.route = "to-node";
      s.etaMs = nowMs + ORBIT_MS;
      pods.set(o.podId, { kind: "shuttle", id: s.shuttleId });
      outbound.push({ orderId: o.orderId, podId: o.podId, shuttleId: s.shuttleId, habitatId: o.habitatId, nodeId: p.nodeId, arriveAt: nowMs + ORBIT_MS });
      queueCallback({ kind: "habitat", id: o.habitatId }, "dispatch", { kind: "collected", orderId: o.orderId, podId: o.podId, shuttleId: s.shuttleId }, nowMs);
    }
  }

  function arriveAtNodes(nowMs: number): void {
    for (let i = outbound.length - 1; i >= 0; i--) {
      const t = outbound[i]!;
      if (nowMs < t.arriveAt) continue;
      outbound.splice(i, 1);
      const { nodeId } = t;
      const s = shuttleOf(t.shuttleId);
      s.pods = s.pods.filter((p) => p !== t.podId);
      if (s.pods.length === 0) s.route = "idle";
      pods.set(t.podId, { kind: "node", id: nodeId });
      queueCallback({ kind: "shuttle", id: t.shuttleId }, "dispatch", { kind: "delivered", orderId: t.orderId, podId: t.podId, shuttleId: t.shuttleId, nodeId }, nowMs);
    }
  }

  function departNodes(nowMs: number, dark: readonly string[]): void {
    for (let i = pendingReturns.length - 1; i >= 0; i--) {
      const r = pendingReturns[i]!;
      if (nowMs < r.windowStart) continue;
      const o = mirror.orders.get(r.orderId);
      const at = o && podLocation(o);
      if (!o || !o.podId || !o.habitatId || !at) continue;
      if (at.kind !== "node") continue;
      if (dark.includes(at.id)) continue;
      const s = shuttleOf(r.shuttleId);
      if (s.pods.length >= SHUTTLE_CAPACITY) continue;
      pendingReturns.splice(i, 1);
      s.pods.push(o.podId);
      s.route = "to-habitat";
      const arriveAt = nextWindowStart(o.habitatId, nowMs + ORBIT_MS);
      s.etaMs = arriveAt;
      pods.set(o.podId, { kind: "shuttle", id: s.shuttleId });
      inbound.push({ orderId: o.orderId, podId: o.podId, shuttleId: s.shuttleId, habitatId: o.habitatId, nodeId: at.id, arriveAt });
    }
  }

  function arriveAtHabitats(nowMs: number): void {
    for (let i = inbound.length - 1; i >= 0; i--) {
      const t = inbound[i]!;
      if (nowMs < t.arriveAt) continue;
      inbound.splice(i, 1);
      const s = shuttleOf(t.shuttleId);
      s.pods = s.pods.filter((p) => p !== t.podId);
      if (s.pods.length === 0) s.route = "idle";
      pods.set(t.podId, { kind: "habitat", id: t.habitatId });
      queueCallback({ kind: "shuttle", id: t.shuttleId }, "dispatch", { kind: "returned", orderId: t.orderId, podId: t.podId, shuttleId: t.shuttleId }, nowMs);
    }
  }

  function reportPositions(nowMs: number): void {
    if (nowMs % POSITION_EVERY_MS !== 0) return;
    for (const s of shuttles.values()) {
      queueCallback({ kind: "shuttle", id: s.shuttleId }, "tracking", { kind: "position", shuttleId: s.shuttleId, orbitPhase: orbitPhaseOf(s, nowMs) }, nowMs);
    }
  }

  async function flushDeliveries(): Promise<void> {
    const batch = pendingDeliveries.splice(0, pendingDeliveries.length);
    for (const req of batch) {
      let accepted = false;
      try {
        accepted = await deps.deliver(req);
      } catch {
        accepted = false;
      }
      if (!accepted) {
        notes.deliveryRetries++;
        pendingDeliveries.push(req);
      }
    }
  }

  return {
    mirror,
    observe(envelopes) {
      for (const envelope of envelopes) {
        const seen = mirror.apply(envelope);
        if (!seen) continue;
        if (seen.topic === "pickup.scheduled") {
          const p = seen.envelope.payload as PayloadOf<"pickup.scheduled">;
          if (!p.nodeId) notes.pickupsWithoutNode++;
          pendingPickups.push({ orderId: p.orderId, shuttleId: p.shuttleId, nodeId: p.nodeId, windowStart: p.windowStart, windowEnd: p.windowEnd });
        } else if (seen.topic === "return.scheduled") {
          const p = seen.envelope.payload as PayloadOf<"return.scheduled">;
          pendingReturns.push({ orderId: p.orderId, shuttleId: p.shuttleId, windowStart: p.windowStart });
        } else if (seen.topic === "order.cancelled") {
          // The crew keeps a pod whose order was cancelled before pickup: the shuttle collects nothing for it.
          const p = seen.envelope.payload as PayloadOf<"order.cancelled">;
          for (let i = pendingPickups.length - 1; i >= 0; i--) if (pendingPickups[i]!.orderId === p.orderId) pendingPickups.splice(i, 1);
        }
      }
    },
    async step(nowMs, dark) {
      arriveAtNodes(nowMs);
      arriveAtHabitats(nowMs);
      collectPickups(nowMs, dark);
      departNodes(nowMs, dark);
      reportPositions(nowMs);
      await flushDeliveries();
    },
    snapshot() {
      return {
        pods: Object.fromEntries(pods),
        shuttles: [...shuttles.values()].map((s) => ({ ...s, pods: [...s.pods] })),
        ordersByState: mirror.countByState(),
        pendingPickups: pendingPickups.length,
        inTransit: outbound.length + inbound.length,
        pendingReturns: pendingReturns.length,
        pendingDeliveries: pendingDeliveries.length,
        malformedEvents: Object.fromEntries(mirror.malformed),
        notes: { ...notes },
      };
    },
  };
}

