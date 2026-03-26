import { z } from "zod";
import { IdSchema, IdempotencyHeaders } from "@sudsnik/contracts";
import { CancelRequest, Order, OrderFilter, PlaceOrder } from "@sudsnik/contracts/services/orders";
import { sendResult, type App } from "@sudsnik/infra-http";
import type { OrdersPort } from "../port.js";

const OrderParams = z.object({ orderId: IdSchema });

/** The four port routes of contracts/src/services/orders/routes.ts over any implementation of the port. */
export function registerRoutes(app: App, service: OrdersPort): void {
  app.post("/orders", { schema: { headers: IdempotencyHeaders, body: PlaceOrder, response: { 201: Order } } }, async (req, reply) => sendResult(reply, await service.place(req.body, req.ctx), 201));
  app.post("/orders/:orderId/cancel", { schema: { headers: IdempotencyHeaders, params: OrderParams, body: CancelRequest, response: { 200: Order } } }, async (req, reply) =>
    sendResult(reply, await service.cancel(req.params.orderId, req.body.reason, req.ctx)),
  );
  app.get("/orders/:orderId", { schema: { params: OrderParams, response: { 200: Order } } }, async (req, reply) => sendResult(reply, await service.get(req.params.orderId, req.ctx)));
  app.get("/orders", { schema: { querystring: OrderFilter, response: { 200: z.array(Order) } } }, async (req, reply) => sendResult(reply, await service.list(req.query, req.ctx)));
}
