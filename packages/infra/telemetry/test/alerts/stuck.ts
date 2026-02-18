import type { AlertRule } from "@sudsnik/contracts";
const rule: AlertRule = { name: "stuck_orders", every: 60_000, evaluate: (m) => (m.counters["orders.stuck"] ?? 0) > 0 };
export default rule;
