import type { AccountsService, BillingService, Ctx, DispatchService, NotifyService, OrdersService, SupportService, TrackingService, WashnodesService } from "@sudsnik/contracts";
import type { HttpClient } from "./http.js";

type Q = Record<string, string | number | undefined>;
function qs(q: Q): string {
  const parts = Object.entries(q)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export function ordersClient(http: HttpClient, base: string): OrdersService {
  const j = <T>(method: "GET" | "POST", path: string, ctx: Ctx, body?: unknown) => http.json<T>({ method, url: base + path, kind: "internal", ctx, body });
  return {
    place: (cmd, ctx) => j("POST", "/orders", ctx, cmd),
    cancel: (orderId, reason, ctx) => j("POST", `/orders/${orderId}/cancel`, ctx, { reason }),
    get: (orderId, ctx) => j("GET", `/orders/${orderId}`, ctx),
    list: (filter, ctx) => j("GET", `/orders${qs(filter)}`, ctx),
  };
}

export function dispatchClient(http: HttpClient, base: string): DispatchService {
  const j = <T>(path: string, ctx: Ctx, body?: unknown) => http.json<T>({ method: "POST", url: base + path, kind: "internal", ctx, body });
  return {
    schedulePickup: (orderId, ctx) => j("/assignments/pickup", ctx, { orderId }),
    scheduleReturn: (orderId, ctx) => j("/assignments/return", ctx, { orderId }),
    reassign: (orderId, ctx) => j(`/assignments/${orderId}/reassign`, ctx, {}),
  };
}

export function washnodesClient(http: HttpClient, base: string): WashnodesService {
  const j = <T>(method: "GET" | "POST", path: string, ctx: Ctx, body?: unknown) => http.json<T>({ method, url: base + path, kind: "internal", ctx, body });
  return {
    acquireHold: (nodeId, orderId, ctx) => j("POST", "/holds", ctx, { nodeId, orderId }),
    releaseHold: (holdId, reason, ctx) => j("POST", `/holds/${holdId}/release`, ctx, { reason }),
    startCycle: (holdId, ctx) => j("POST", `/holds/${holdId}/start`, ctx, {}),
    status: (nodeId, ctx) => j("GET", `/nodes/${nodeId}`, ctx),
  };
}

export function billingClient(http: HttpClient, base: string): BillingService {
  const j = <T>(method: "GET" | "POST", path: string, ctx: Ctx, body?: unknown) => http.json<T>({ method, url: base + path, kind: "internal", ctx, body });
  return {
    quote: (orderId, ctx) => j("GET", `/quotes/${orderId}`, ctx),
    authorize: (orderId, amount, ctx) => j("POST", "/charges/authorize", ctx, { orderId, amount }),
    capture: (orderId, ctx) => j("POST", `/charges/${orderId}/capture`, ctx, {}),
    refund: (orderId, ctx) => j("POST", `/charges/${orderId}/refund`, ctx, {}),
    ledger: (filter, ctx) => j("GET", `/ledger${qs(filter)}`, ctx),
  };
}

export function trackingClient(http: HttpClient, base: string): TrackingService {
  const j = <T>(path: string, ctx: Ctx) => http.json<T>({ method: "GET", url: base + path, kind: "internal", ctx });
  return {
    position: (shuttleId, ctx) => j(`/positions/${shuttleId}`, ctx),
    positions: (ctx) => j("/positions", ctx),
    podLocation: (podId, ctx) => j(`/pods/${podId}`, ctx),
  };
}

export function accountsClient(http: HttpClient, base: string): AccountsService {
  const j = <T>(method: "GET" | "PUT", path: string, ctx: Ctx, body?: unknown) => http.json<T>({ method, url: base + path, kind: "internal", ctx, body });
  return {
    operator: (operatorId, ctx) => j("GET", `/operators/${operatorId}`, ctx),
    habitat: (habitatId, ctx) => j("GET", `/habitats/${habitatId}`, ctx),
    crew: (habitatId, ctx) => j("GET", `/habitats/${habitatId}/crew`, ctx),
    updateOperator: (operatorId, patch, ctx) => j("PUT", `/operators/${operatorId}`, ctx, patch),
  };
}

export function notifyClient(http: HttpClient, base: string): NotifyService {
  const j = <T>(method: "GET" | "POST", path: string, ctx: Ctx, body?: unknown) => http.json<T>({ method, url: base + path, kind: "internal", ctx, body });
  return {
    send: (n, ctx) => j("POST", "/notifications", ctx, n),
    digest: (habitatId, ctx) => j("GET", `/habitats/${habitatId}/digest`, ctx),
  };
}

export function supportClient(http: HttpClient, base: string): SupportService {
  const j = <T>(method: "GET" | "POST", path: string, ctx: Ctx, body?: unknown) => http.json<T>({ method, url: base + path, kind: "internal", ctx, body });
  return {
    report: (r, ctx) => j("POST", "/reports", ctx, r),
    triage: (reportId, ctx) => j("POST", `/reports/${reportId}/triage`, ctx, {}),
    escalate: (reportId, ctx) => j("POST", `/reports/${reportId}/escalate`, ctx, {}),
  };
}
