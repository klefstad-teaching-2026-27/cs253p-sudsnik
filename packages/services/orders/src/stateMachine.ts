import { TERMINAL_STATES, type OrderState } from "@sudsnik/contracts/services/orders";

/** What moves an order: a consumed topic, the two outcomes of wash.faulted, or the cancel command (system-spec §9.3). */
export type Trigger =
  | "pickup.scheduled"
  | "hold.expired"
  | "pod.collected"
  | "pod.delivered"
  | "wash.started"
  | "wash.faulted:retry"
  | "wash.faulted:final"
  | "wash.completed"
  | "return.scheduled"
  | "pod.returned"
  | "pickup.failed"
  | "cancel";

export const transitions: Record<OrderState, Partial<Record<Trigger, OrderState>>> = {
  placed: { "pickup.scheduled": "scheduled", "pickup.failed": "cancelled", cancel: "cancelled" },
  scheduled: { "hold.expired": "placed", "pod.collected": "collected", "pickup.failed": "cancelled", cancel: "cancelled" },
  collected: { "pod.delivered": "delivered", "pickup.failed": "cancelled", cancel: "cancelled" },
  delivered: { "wash.started": "washing", "pickup.failed": "cancelled", cancel: "cancelled" },
  washing: { "wash.faulted:retry": "delivered", "wash.faulted:final": "cancelled", "wash.completed": "washed" },
  washed: { "return.scheduled": "returning" },
  returning: { "pod.returned": "returned" },
  returned: {},
  cancelled: {},
};

/** The state `trigger` moves `from` into, or undefined when the table has no such row. */
export function nextState(from: OrderState, trigger: Trigger): OrderState | undefined {
  return transitions[from][trigger];
}

export function isTerminal(state: OrderState): boolean {
  return TERMINAL_STATES.includes(state);
}
