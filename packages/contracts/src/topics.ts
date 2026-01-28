export const SERVICES = ["gateway", "orders", "dispatch", "washnodes", "billing", "tracking", "accounts", "notify", "support"] as const;
export type Service = (typeof SERVICES)[number];

export const TOPICS = [
  "order.placed",
  "order.cancelled",
  "order.returned",
  "pickup.scheduled",
  "pod.collected",
  "pod.delivered",
  "return.scheduled",
  "pickup.failed",
  "pod.returned",
  "hold.acquired",
  "hold.released",
  "hold.expired",
  "wash.started",
  "wash.completed",
  "wash.faulted",
  "position.updated",
  "charge.captured",
  "charge.failed",
  "refund.issued",
  "notification.failed",
  "anomaly.reported",
  "triage.completed",
  "operator.updated",
  "clock.tick",
] as const;
export type Topic = (typeof TOPICS)[number];

export function isTopic(s: string): s is Topic {
  return (TOPICS as readonly string[]).includes(s);
}

/**
 * Services that serve a `/v2` surface of their own. The gateway forwards `/v2/<service>/<rest>` to `/v2/<rest>`
 * for these and to `<rest>` for every other service, so a version a service has not migrated still works.
 */
export const V2_SERVICES: readonly Service[] = [];

export function hasV2(service: Service): boolean {
  return V2_SERVICES.includes(service);
}

export const SYSTEM_TENANT = "system";
/** Topics whose envelope carries tenantId "system". */
export const SYSTEM_TOPICS: readonly Topic[] = ["clock.tick", "position.updated"];

export const declaredTopics: Record<Service, { publishes: Topic[]; consumes: Topic[] }> = {
  gateway: { publishes: [], consumes: ["operator.updated"] },
  orders: {
    publishes: ["order.placed", "order.cancelled", "order.returned"],
    consumes: [
      "pickup.scheduled",
      "pod.collected",
      "pod.delivered",
      "wash.started",
      "wash.completed",
      "wash.faulted",
      "hold.expired",
      "return.scheduled",
      "pod.returned",
      "pickup.failed",
      "charge.captured",
      "charge.failed",
      "refund.issued",
    ],
  },
  dispatch: {
    publishes: ["pickup.scheduled", "pod.collected", "pod.delivered", "return.scheduled", "pod.returned", "pickup.failed"],
    consumes: ["order.placed", "order.cancelled", "hold.acquired", "hold.released", "hold.expired", "wash.completed", "position.updated"],
  },
  washnodes: {
    publishes: ["hold.acquired", "hold.released", "hold.expired", "wash.started", "wash.completed", "wash.faulted"],
    consumes: ["pod.delivered", "anomaly.reported", "triage.completed"],
  },
  billing: {
    publishes: ["charge.captured", "charge.failed", "refund.issued"],
    consumes: ["order.returned", "wash.completed", "operator.updated"],
  },
  tracking: {
    publishes: ["position.updated"],
    consumes: ["pickup.scheduled", "pod.collected", "pod.delivered", "wash.started", "return.scheduled", "pod.returned"],
  },
  accounts: { publishes: ["operator.updated"], consumes: [] },
  notify: {
    publishes: ["notification.failed"],
    consumes: [
      "order.placed",
      "order.cancelled",
      "order.returned",
      "pickup.scheduled",
      "return.scheduled",
      "charge.captured",
      "charge.failed",
      "refund.issued",
      "triage.completed",
    ],
  },
  support: {
    publishes: ["anomaly.reported", "triage.completed"],
    consumes: ["order.returned", "wash.faulted", "notification.failed"],
  },
};

/** Every service consumes clock.tick through infra/queue; it is not listed per service. */
export function mayPublish(service: Service, topic: Topic): boolean {
  return declaredTopics[service].publishes.includes(topic);
}
export function mayConsume(service: Service, topic: Topic): boolean {
  return topic === "clock.tick" || declaredTopics[service].consumes.includes(topic);
}
