import { payloadSchemas, type Envelope, type PayloadOf, type Topic } from "@sudsnik/contracts";

export const ORDER_STATES = ["placed", "scheduled", "collected", "delivered", "washing", "washed", "returning", "returned", "cancelled"] as const;
export type OrderState = (typeof ORDER_STATES)[number];
export const TERMINAL_STATES: readonly OrderState[] = ["returned", "cancelled"];

export type HoldStatus = "active" | "released" | "expired" | "consumed";

export interface HoldRecord {
  holdId: string;
  washerId: string;
  nodeId: string;
  acquiredAt: number;
  expiresAt: number;
  status: HoldStatus;
  /** When the hold stopped being active by an event; undefined while active. */
  endedAt?: number;
}

export interface LaunchRecord {
  shuttleId: string;
  windowStart: number;
  windowEnd: number;
  scheduledAt: number;
}

export interface OrderRecord {
  orderId: string;
  tenantId: string;
  habitatId?: string;
  podId?: string;
  placedAt: number;
  state: OrderState;
  lastChangeAt: number;
  transitions: Array<{ state: OrderState; atMs: number }>;
  holds: HoldRecord[];
  pickups: LaunchRecord[];
  returns: LaunchRecord[];
  /** A service marked the order permanently failed: wash.faulted with final = true (system-spec §10.2). */
  permanentlyFailed: boolean;
  /** The `origin` of the first order.cancelled seen: `system` means a service gave up on the order rather than anyone asking (system-spec §10.2). */
  cancelledBy?: PayloadOf<"order.cancelled">["origin"];
  /** When the first `order.cancelled` was seen; later ones do not move it. */
  cancelledAt?: number;
  /** States an event moved the order to after its cancellation, in stream order; the order itself stays cancelled. */
  afterCancel: Array<{ state: OrderState; atMs: number }>;
  returnedAt?: number;
  /** Every `charge.captured` and `refund.issued` seen, in stream order. */
  charges: Array<{ chargeId: string; atMs: number }>;
  refunds: Array<{ refundId: string; atMs: number }>;
}

export interface ObservedEvent<T extends Topic = Topic> {
  envelope: Envelope<PayloadOf<T>>;
  topic: T;
}

/** Parses an envelope's payload against its topic schema; undefined when the payload does not conform. */
export function observe(envelope: Envelope): ObservedEvent | undefined {
  const schema = payloadSchemas[envelope.topic];
  if (!schema) return undefined;
  const parsed = schema.safeParse(envelope.payload);
  if (!parsed.success) return undefined;
  return { envelope: { ...envelope, payload: parsed.data } as Envelope<never>, topic: envelope.topic };
}

export function isTerminal(state: OrderState): boolean {
  return TERMINAL_STATES.includes(state);
}

/**
 * The order state machine of system-spec §9.3, mirrored from the bus. An event moves the order to the state it
 * names whatever the current state, so the mirror follows what services actually emitted rather than what they
 * should have; the judges compare the two.
 */
export class OrderMirror {
  readonly orders = new Map<string, OrderRecord>();
  /** Events whose payload failed its schema, by topic. */
  readonly malformed = new Map<string, number>();

  private orderFor(orderId: string, envelope: Envelope): OrderRecord {
    let o = this.orders.get(orderId);
    if (!o) {
      o = {
        orderId,
        tenantId: envelope.tenantId,
        placedAt: envelope.occurredAt,
        state: "placed",
        lastChangeAt: envelope.occurredAt,
        transitions: [{ state: "placed", atMs: envelope.occurredAt }],
        holds: [],
        pickups: [],
        returns: [],
        permanentlyFailed: false,
        charges: [],
        refunds: [],
        afterCancel: [],
      };
      this.orders.set(orderId, o);
    }
    return o;
  }

  private moveTo(o: OrderRecord, state: OrderState, atMs: number): void {
    if (o.state === state) return;
    // A cancellation is terminal: what services emit for the order afterwards is recorded against them, not
    // followed, so a pickup scheduled in the same moment as the cancel does not read as an order still running.
    if (o.state === "cancelled" && o.cancelledBy === "customer") {
      o.afterCancel.push({ state, atMs });
      return;
    }
    o.state = state;
    o.lastChangeAt = atMs;
    o.transitions.push({ state, atMs });
  }

  private endHold(o: OrderRecord, holdId: string | undefined, status: HoldStatus, atMs: number): void {
    const hold = holdId ? o.holds.find((h) => h.holdId === holdId) : [...o.holds].reverse().find((h) => h.status === "active");
    if (!hold || hold.status !== "active") return;
    hold.status = status;
    hold.endedAt = atMs;
  }

  apply(envelope: Envelope): ObservedEvent | undefined {
    const seen = observe(envelope);
    if (!seen) {
      this.malformed.set(envelope.topic, (this.malformed.get(envelope.topic) ?? 0) + 1);
      return undefined;
    }
    const at = envelope.occurredAt;
    switch (seen.topic) {
      case "order.placed": {
        const p = seen.envelope.payload as PayloadOf<"order.placed">;
        const o = this.orderFor(p.orderId, envelope);
        o.habitatId = p.habitatId;
        o.podId = p.podId;
        o.placedAt = at;
        o.transitions[0]!.atMs = at;
        if (o.state === "placed") o.lastChangeAt = at;
        break;
      }
      case "pickup.scheduled": {
        const p = seen.envelope.payload as PayloadOf<"pickup.scheduled">;
        const o = this.orderFor(p.orderId, envelope);
        o.habitatId ??= p.habitatId;
        o.podId ??= p.podId;
        o.pickups.push({ shuttleId: p.shuttleId, windowStart: p.windowStart, windowEnd: p.windowEnd, scheduledAt: at });
        this.moveTo(o, "scheduled", at);
        break;
      }
      case "hold.expired": {
        const p = seen.envelope.payload as PayloadOf<"hold.expired">;
        const o = this.orderFor(p.orderId, envelope);
        this.endHold(o, p.holdId, "expired", at);
        if (o.state === "scheduled") this.moveTo(o, "placed", at);
        break;
      }
      case "pod.collected": {
        const p = seen.envelope.payload as PayloadOf<"pod.collected">;
        const o = this.orderFor(p.orderId, envelope);
        o.podId ??= p.podId;
        this.moveTo(o, "collected", at);
        break;
      }
      case "pod.delivered": {
        const p = seen.envelope.payload as PayloadOf<"pod.delivered">;
        this.moveTo(this.orderFor(p.orderId, envelope), "delivered", at);
        break;
      }
      case "wash.started": {
        const p = seen.envelope.payload as PayloadOf<"wash.started">;
        const o = this.orderFor(p.orderId, envelope);
        this.endHold(o, undefined, "consumed", at);
        this.moveTo(o, "washing", at);
        break;
      }
      case "wash.faulted": {
        const p = seen.envelope.payload as PayloadOf<"wash.faulted">;
        const o = this.orderFor(p.orderId, envelope);
        if (p.final) o.permanentlyFailed = true;
        this.moveTo(o, p.final ? "cancelled" : "delivered", at);
        break;
      }
      case "wash.completed": {
        const p = seen.envelope.payload as PayloadOf<"wash.completed">;
        const o = this.orderFor(p.orderId, envelope);
        this.endHold(o, undefined, "consumed", at);
        this.moveTo(o, "washed", at);
        break;
      }
      case "return.scheduled": {
        const p = seen.envelope.payload as PayloadOf<"return.scheduled">;
        const o = this.orderFor(p.orderId, envelope);
        o.returns.push({ shuttleId: p.shuttleId, windowStart: p.windowStart, windowEnd: p.windowEnd, scheduledAt: at });
        this.moveTo(o, "returning", at);
        break;
      }
      case "pod.returned": {
        const p = seen.envelope.payload as PayloadOf<"pod.returned">;
        this.moveTo(this.orderFor(p.orderId, envelope), "returned", at);
        break;
      }
      case "order.returned": {
        const p = seen.envelope.payload as PayloadOf<"order.returned">;
        const o = this.orderFor(p.orderId, envelope);
        o.returnedAt ??= p.returnedAt;
        this.moveTo(o, "returned", at);
        break;
      }
      case "order.cancelled": {
        const p = seen.envelope.payload as PayloadOf<"order.cancelled">;
        const o = this.orderFor(p.orderId, envelope);
        // The first cancellation is the one judged; a service giving up on the order later does not rewrite it.
        o.cancelledBy ??= p.origin;
        o.cancelledAt ??= at;
        this.moveTo(o, "cancelled", at);
        break;
      }
      case "charge.captured": {
        // The bus is at-least-once; a capture delivered twice is one capture, a second chargeId is a second charge.
        const p = seen.envelope.payload as PayloadOf<"charge.captured">;
        const o = this.orderFor(p.orderId, envelope);
        if (!o.charges.some((c) => c.chargeId === p.chargeId)) o.charges.push({ chargeId: p.chargeId, atMs: at });
        break;
      }
      case "refund.issued": {
        const p = seen.envelope.payload as PayloadOf<"refund.issued">;
        const o = this.orderFor(p.orderId, envelope);
        if (!o.refunds.some((r) => r.refundId === p.refundId)) o.refunds.push({ refundId: p.refundId, atMs: at });
        break;
      }
      case "hold.acquired": {
        const p = seen.envelope.payload as PayloadOf<"hold.acquired">;
        const o = this.orderFor(p.orderId, envelope);
        o.holds.push({ holdId: p.holdId, washerId: p.washerId, nodeId: p.nodeId, acquiredAt: at, expiresAt: p.expiresAt, status: "active" });
        break;
      }
      case "hold.released": {
        const p = seen.envelope.payload as PayloadOf<"hold.released">;
        this.endHold(this.orderFor(p.orderId, envelope), p.holdId, "released", at);
        break;
      }
      default:
        break;
    }
    return seen;
  }

  countByState(): Record<OrderState, number> {
    const out = Object.fromEntries(ORDER_STATES.map((s) => [s, 0])) as Record<OrderState, number>;
    for (const o of this.orders.values()) out[o.state]++;
    return out;
  }
}
