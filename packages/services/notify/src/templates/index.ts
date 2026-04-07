import type { Topic } from "@sudsnik/contracts";
import type { Notification } from "@sudsnik/contracts/services/notify";

export type Params = Record<string, string>;

export interface Rendered {
  title: string;
  body: string;
}

interface Template {
  channel: Notification["channel"];
  render(p: Params): Rendered;
}

const money = (p: Params) => `${p.amount ?? "?"} ${p.currency ?? ""}`.trim();
const order = (p: Params) => `order ${p.orderId ?? "?"}`;

/** One template per consumed topic, keyed by the topic name; `send` may name any of them. */
export const TEMPLATES: Record<string, Template> = {
  "order.placed": {
    channel: "habitat-console",
    render: (p) => ({ title: "Laundry order placed", body: `${order(p)} for pod ${p.podId ?? "?"} is placed.` }),
  },
  "order.cancelled": {
    channel: "habitat-console",
    render: (p) => ({ title: "Laundry order cancelled", body: `${order(p)} was cancelled: ${p.reason ?? "no reason given"}.` }),
  },
  "order.returned": {
    channel: "habitat-console",
    render: (p) => ({ title: "Laundry returned", body: `${order(p)} is back after ${p.orbitsElapsed ?? "?"} orbits.` }),
  },
  "pickup.scheduled": {
    channel: "pod-display",
    render: (p) => ({ title: "Pickup scheduled", body: `Shuttle ${p.shuttleId ?? "?"} collects ${order(p)} between ${p.windowStart ?? "?"} and ${p.windowEnd ?? "?"}.` }),
  },
  "return.scheduled": {
    channel: "pod-display",
    render: (p) => ({ title: "Return scheduled", body: `Shuttle ${p.shuttleId ?? "?"} returns ${order(p)} between ${p.windowStart ?? "?"} and ${p.windowEnd ?? "?"}.` }),
  },
  "charge.captured": {
    channel: "habitat-console",
    render: (p) => ({ title: "Payment captured", body: `${money(p)} charged for ${order(p)} (charge ${p.chargeId ?? "?"}).` }),
  },
  "charge.failed": {
    channel: "habitat-console",
    render: (p) => ({ title: "Payment failed", body: `Payment for ${order(p)} failed: ${p.reason ?? "no reason given"}.` }),
  },
  "refund.issued": {
    channel: "habitat-console",
    render: (p) => ({ title: "Refund issued", body: `${money(p)} refunded for ${order(p)} (refund ${p.refundId ?? "?"}).` }),
  },
  "triage.completed": {
    channel: "habitat-console",
    render: (p) => ({ title: "Anomaly report triaged", body: `Report ${p.reportId ?? "?"}: ${p.category ?? "?"}, severity ${p.severity ?? "?"}, action ${p.action ?? "?"}.` }),
  },
};

export function templateFor(topic: Topic): Template | undefined {
  return TEMPLATES[topic];
}

/** Renders a named template; a name with no template renders its params as lines so `send` never fails on the name. */
export function render(template: string, params: Params): Rendered {
  const t = TEMPLATES[template];
  if (t) return t.render(params);
  const body = Object.entries(params)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return { title: template, body };
}

/** Event payload fields as the string params a template renders from. */
export function stringParams(payload: unknown): Params {
  if (typeof payload !== "object" || payload === null) return {};
  const out: Params = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}
