import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { IDEMPOTENCY_HEADER } from "@sudsnik/contracts";
import {
  AuthorizeRequest,
  CaptureRequest,
  PaymentResponse,
  RefundRequest,
  type PaymentsWebhook,
} from "@sudsnik/contracts/mocks/payments";
import { createMockApp, latencyMs, type MockOptions } from "../mock.js";
import { relaySender } from "../relay-client.js";

export const PAYMENTS_QUOTA_PER_ORBIT = 500;
export const TIMEOUT_RATE = 0.02;
export const DUPLICATE_WEBHOOK_RATE = 0.05;

export interface PaymentsOptions extends MockOptions {
  relayUrl: string;
}

interface Payment extends PaymentResponse {
  tenant: string;
  orderId: string;
  callbackUrl: string;
}

interface Cached {
  status: number;
  body: unknown;
}

export async function createMock(opts: PaymentsOptions): Promise<FastifyInstance> {
  const mock = await createMockApp("payments", opts);
  const { app } = mock;
  const relay = relaySender(opts.relayUrl);
  const quota = mock.quota(() => PAYMENTS_QUOTA_PER_ORBIT);
  const payments = new Map<string, Payment>();
  const replies = new Map<string, Cached>();

  const idemKey = (req: FastifyRequest): string | undefined => {
    const raw = req.headers[IDEMPOTENCY_HEADER];
    const key = Array.isArray(raw) ? raw[0] : raw;
    return key ? `${req.tenant}\n${req.routeOptions.url}\n${key}` : undefined;
  };

  /** Quota, idempotent replay, and the timeout draw, shared by every call; returns the reply when it handled the call. */
  const gate = (req: FastifyRequest, reply: FastifyReply): FastifyReply | undefined => {
    const key = idemKey(req);
    const cached = key ? replies.get(key) : undefined;
    if (cached) return reply.header("idempotent-replayed", "true").code(cached.status).send(cached.body);
    if (!quota.take(req.tenant)) {
      return mock.fail(reply, "QUOTA", `quota of ${PAYMENTS_QUOTA_PER_ORBIT} calls per orbit spent`, { "retry-after": String(mock.secondsToNextOrbit()) });
    }
    if (mock.rng("faults").chance(mock.rate("timeout-rate", TIMEOUT_RATE))) return mock.timeout(req, reply);
    return undefined;
  };

  const answer = (req: FastifyRequest, reply: FastifyReply, status: number, body: unknown): FastifyReply => {
    const key = idemKey(req);
    if (key) replies.set(key, { status, body });
    return reply.code(status).send(body);
  };

  const webhook = async (p: Payment, event: PaymentsWebhook["event"]): Promise<void> => {
    const atMs = mock.nowMs() + latencyMs(mock, 200, 2_000);
    const body: PaymentsWebhook = { id: mock.id("wh"), paymentRef: p.paymentRef, orderId: p.orderId, event, amount: p.amount, currency: p.currency, atMs };
    const copies = 1 + (mock.rng("faults").chance(mock.rate("duplicate-webhook-rate", DUPLICATE_WEBHOOK_RATE)) ? 1 : 0);
    for (let i = 0; i < copies; i++) {
      await relay.send(p.tenant, {
        origin: { kind: "ground", id: "payments" },
        destination: { kind: "ground", id: "billing" },
        to: p.callbackUrl,
        path: "/payments",
        body,
        deliverAtMs: atMs,
      });
    }
  };

  const publicView = (p: Payment): PaymentResponse => ({ paymentRef: p.paymentRef, state: p.state, amount: p.amount, currency: p.currency });

  app.post("/authorize", { schema: { body: AuthorizeRequest } }, async (req, reply) => {
    const handled = gate(req, reply);
    if (handled) return handled;
    const p: Payment = { paymentRef: mock.id("pay"), state: "authorized", tenant: req.tenant, ...req.body };
    payments.set(p.paymentRef, p);
    return answer(req, reply, 201, publicView(p));
  });

  app.post("/capture", { schema: { body: CaptureRequest } }, async (req, reply) => {
    const handled = gate(req, reply);
    if (handled) return handled;
    const p = payments.get(req.body.paymentRef);
    if (!p || p.tenant !== req.tenant) return mock.fail(reply, "NOT_FOUND", `no payment ${req.body.paymentRef}`);
    if (p.state !== "authorized") return mock.fail(reply, "CONFLICT", `payment is ${p.state}`);
    if (req.body.amount !== undefined && req.body.amount > p.amount) return mock.fail(reply, "INVALID", "capture exceeds authorization");
    p.state = "captured";
    if (req.body.amount !== undefined) p.amount = req.body.amount;
    await webhook(p, "captured");
    return answer(req, reply, 200, publicView(p));
  });

  app.post("/refund", { schema: { body: RefundRequest } }, async (req, reply) => {
    const handled = gate(req, reply);
    if (handled) return handled;
    const p = payments.get(req.body.paymentRef);
    if (!p || p.tenant !== req.tenant) return mock.fail(reply, "NOT_FOUND", `no payment ${req.body.paymentRef}`);
    if (p.state !== "captured") return mock.fail(reply, "CONFLICT", `payment is ${p.state}`);
    if (req.body.amount !== undefined && req.body.amount > p.amount) return mock.fail(reply, "INVALID", "refund exceeds capture");
    p.state = "refunded";
    if (req.body.amount !== undefined) p.amount = req.body.amount;
    await webhook(p, "refunded");
    return answer(req, reply, 200, publicView(p));
  });

  return app;
}
