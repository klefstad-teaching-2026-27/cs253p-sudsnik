import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "vitest";
import { rules } from "../src/index.js";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester();

const svc = "/repo/packages/services/orders/src/domain.ts";
const svcTest = "/repo/packages/services/orders/test/domain.test.ts";
const infra = "/repo/packages/infra/queue/src/bus.ts";
const external = "/repo/packages/external/src/relay.ts";
const app = "/repo/apps/sim/src/main.ts";
const tool = "/repo/tools/lint/src/main.ts";
const clients = "/repo/packages/clients/src/http.ts";
const infraHttp = "/repo/packages/infra/http/src/index.ts";
const contractsTesting = "/repo/packages/contracts/testing/fakeDeps.ts";

tester.run("no-wall-clock", rules["no-wall-clock"], {
  valid: [
    { code: "const t = deps.clock.now();", filename: svc },
    { code: "new Date(0); new Date(ms);", filename: svc },
    { code: "setTimeout(fn, ms); setTimeout(fn);", filename: svc },
    { code: "Date.now(); new Date(); setTimeout(fn, 10);", filename: svcTest },
    { code: "Date.now();", filename: infra },
    { code: "Date.now();", filename: external },
    { code: "Date.now();", filename: app },
    { code: "Date.now();", filename: tool },
    { code: "Date.now();", filename: "/repo/packages/services/orders/migrations/001.ts" },
  ],
  invalid: [
    { code: "const t = Date.now();", filename: svc, errors: [{ messageId: "dateNow" }] },
    { code: "const t = new Date();", filename: svc, errors: [{ messageId: "newDate" }] },
    { code: "setTimeout(fn, 1_000);", filename: svc, errors: [{ messageId: "literalTimer", data: { name: "setTimeout" } }] },
    { code: "setInterval(fn, 50);", filename: svc, errors: [{ messageId: "literalTimer", data: { name: "setInterval" } }] },
    { code: "globalThis.setTimeout(fn, 5);", filename: svc, errors: [{ messageId: "literalTimer" }] },
    { code: "Date.now();", filename: "/repo/packages/kernel/src/clock.ts", errors: [{ messageId: "dateNow" }] },
  ],
});

tester.run("metered-clients-only", rules["metered-clients-only"], {
  valid: [
    { code: 'import { z } from "zod";', filename: svc },
    { code: "const r = await deps.clients.payments.charge(x);", filename: svc },
    { code: "function fetch() {} fetch();", filename: svc },
    { code: "const fetch = 1; fetch;", filename: svc },
    { code: 'import undici from "undici"; fetch(url);', filename: clients },
    { code: 'import http from "node:http";', filename: external },
    { code: 'import http from "http";', filename: app },
    { code: 'import https from "https";', filename: tool },
    { code: 'import { request } from "undici";', filename: infraHttp },
    { code: 'import { request } from "undici";', filename: "/repo/packages/kernel/src/x.ts", options: [{ exempt: ["packages/kernel"] }] },
  ],
  invalid: [
    { code: 'import { request } from "undici";', filename: svc, errors: [{ messageId: "rawModule", data: { source: "undici" } }] },
    { code: 'import http from "node:http";', filename: svc, errors: [{ messageId: "rawModule" }] },
    { code: 'import https from "node:https";', filename: svc, errors: [{ messageId: "rawModule" }] },
    { code: 'const http = require("http");', filename: svc, errors: [{ messageId: "rawModule" }] },
    { code: 'const m = await import("https");', filename: svc, errors: [{ messageId: "rawModule" }] },
    { code: 'export * from "undici";', filename: svc, errors: [{ messageId: "rawModule" }] },
    { code: "await fetch(url);", filename: svc, errors: [{ messageId: "globalFetch" }] },
    { code: "const f = globalThis.fetch;", filename: svc, errors: [{ messageId: "globalFetch" }] },
    { code: "fetch(url);", filename: "/repo/packages/infra/queue/src/bus.ts", errors: [{ messageId: "globalFetch" }] },
    { code: "fetch(url);", filename: clients, options: [{ exempt: [] }], errors: [{ messageId: "globalFetch" }] },
  ],
});

tester.run("tenant-field-required", rules["tenant-field-required"], {
  valid: [
    { code: "const OrderRow = z.object({ id: z.string(), tenantId: z.string() });", filename: svc },
    { code: "export const OrderRow = z.object({ tenantId: z.string() }).strict();", filename: svc },
    { code: "const MoneySchema = z.object({ amount: z.number() });", filename: svc },
    { code: "const OrderRequest = z.object({ podId: z.string() });", filename: svc },
    { code: "const OrderRow = z.object({ ...Base.shape, id: z.string() });", filename: svc },
    { code: "export const EnvelopeSchema = z.object({ id: z.string(), tenantId: z.string() });", filename: "/repo/packages/contracts/src/envelope.ts" },
    { code: "const SystemRow = z.object({ id: z.string() });", filename: svc, options: [{ allow: ["SystemRow"] }] },
    { code: "const OrderRow = z.object({ id: z.string() });", filename: svc, options: [{ rowPattern: "Record$" }] },
    { code: 'const rows = { order: z.object({ id: z.string() }) };', filename: svc },
  ],
  invalid: [
    { code: "const OrderRow = z.object({ id: z.string() });", filename: svc, errors: [{ messageId: "missingTenant", data: { name: "OrderRow" } }] },
    { code: "export const OrderRow = z.object({ id: z.string() }).strict();", filename: svc, errors: [{ messageId: "missingTenant" }] },
    { code: "const OrderRow = z.strictObject({ id: z.string() });", filename: svc, errors: [{ messageId: "missingTenant" }] },
    { code: "export const EnvelopeSchema = z.object({ id: z.string() });", filename: "/repo/packages/contracts/src/envelope.ts", errors: [{ messageId: "missingTenant", data: { name: "EnvelopeSchema" } }] },
    { code: "const rows = { OrderRow: z.object({ id: z.string() }) };", filename: svc, errors: [{ messageId: "missingTenant" }] },
    { code: "const OrderRecord = z.object({ id: z.string() });", filename: svc, options: [{ rowPattern: "Record$" }], errors: [{ messageId: "missingTenant" }] },
  ],
});

const variantA = "/repo/packages/services/billing/src/variants/golden/index.ts";

tester.run("no-cross-variant-import", rules["no-cross-variant-import"], {
  valid: [
    { code: 'export { createBilling } from "./variants/golden/index.js";', filename: "/repo/packages/services/billing/src/index.ts" },
    { code: 'import { x } from "./ledger.js";', filename: variantA },
    { code: 'import { x } from "../../port.js";', filename: variantA },
    { code: 'import { createBilling } from "@sudsnik/billing";', filename: svc },
    { code: 'import { golden } from "../src/variants/golden/index.js";', filename: "/repo/packages/services/billing/test/billing.test.ts" },
  ],
  invalid: [
    { code: 'import { x } from "@sudsnik/billing/src/variants/golden/ledger.js";', filename: svc, errors: [{ messageId: "otherPackage" }] },
    { code: 'import { x } from "../../billing/src/variants/golden/index.js";', filename: svc, errors: [{ messageId: "otherPackage" }] },
    { code: 'const m = await import("../../billing/src/variants/golden/index.js");', filename: svc, errors: [{ messageId: "otherPackage" }] },
    { code: 'import { x } from "../naive/index.js";', filename: variantA, errors: [{ messageId: "otherVariant" }] },
    { code: 'import { x } from "../../variants/naive/index.js";', filename: variantA, errors: [{ messageId: "otherVariant" }] },
    { code: 'import { naiveStore } from "../variants/naive/storage.js";', filename: "/repo/packages/services/billing/src/app.js", errors: [{ messageId: "sharedCode" }] },
    { code: 'import { golden } from "./variants/golden/index.js";', filename: "/repo/packages/services/billing/src/start.ts", errors: [{ messageId: "sharedCode" }] },
  ],
});

tester.run("env-via-read-env", rules["env-via-read-env"], {
  valid: [
    { code: "export function readEnv() { return Schema.parse(process.env); }", filename: svc },
    { code: "export const readEnv = () => Schema.parse(process.env);", filename: svc },
    { code: "class C { readEnv() { return process.env.X; } }", filename: svc },
    { code: "function readEnv() { const get = () => process.env.SUDSNIK_PORT; return get(); }", filename: svc },
    { code: "const port = deps.env.SUDSNIK_PORT;", filename: svc },
    { code: "process.env.X;", filename: infra },
    { code: "process.env.X;", filename: app },
    { code: "process.env.X;", filename: tool },
    { code: "process.env.X;", filename: external },
    { code: "process.env.X;", filename: contractsTesting },
  ],
  invalid: [
    { code: "const port = process.env.SUDSNIK_PORT;", filename: svc, errors: [{ messageId: "outsideReadEnv" }] },
    { code: "function start() { return process.env.SUDSNIK_PORT; }", filename: svc, errors: [{ messageId: "outsideReadEnv" }] },
    { code: "export function readEnvironment() { return process.env; }", filename: svc, errors: [{ messageId: "outsideReadEnv" }] },
    { code: 'const x = process["env"];', filename: svc, errors: [{ messageId: "outsideReadEnv" }] },
    { code: "process.env.X;", filename: "/repo/packages/contracts/src/env.ts", errors: [{ messageId: "outsideReadEnv" }] },
  ],
});

tester.run("topic-declared", rules["topic-declared"], {
  valid: [
    { code: 'await deps.bus.publish({ topic: "order.placed", payload });', filename: svc },
    { code: 'deps.bus.subscribe("clock.tick", handler, { consumer: "orders" });', filename: svc },
    { code: 'makeEnvelope({ topic: "wash.completed", occurredAt: 0, payload });', filename: svc },
    { code: "deps.bus.subscribe(topic, handler);", filename: svc },
    { code: "deps.bus.publish(envelope);", filename: svc },
    { code: "deps.bus.publish({ topic, payload });", filename: svc },
    { code: 'emitter.publish({ topic: "order.placed" });', filename: infra },
  ],
  invalid: [
    { code: 'await deps.bus.publish({ topic: "order.plased", payload });', filename: svc, errors: [{ messageId: "unknownTopic", data: { topic: "order.plased" } }] },
    { code: 'deps.bus.subscribe("orders.placed", handler, { consumer: "orders" });', filename: svc, errors: [{ messageId: "unknownTopic" }] },
    { code: "deps.bus.subscribe(`orders.placed`, handler);", filename: svc, errors: [{ messageId: "unknownTopic" }] },
    { code: 'makeEnvelope({ topic: "wash.done", occurredAt: 0, payload });', filename: svc, errors: [{ messageId: "unknownTopic" }] },
    { code: 'bus.publish({ topic: "nope" });', filename: infra, errors: [{ messageId: "unknownTopic" }] },
  ],
});

const withHeader = 'schema: { headers: z.object({ "idempotency-key": z.string() }) }';

tester.run("idempotency-key-on-writes", rules["idempotency-key-on-writes"], {
  valid: [
    { code: `app.post("/v1/orders", { ${withHeader} }, handler);`, filename: svc },
    { code: `app.put("/v1/orders/:id", { schema: { headers: z.object({ "Idempotency-Key": z.string() }) } }, handler);`, filename: svc },
    { code: `app.post("/callbacks/payments", { schema: { body: Body } }, handler);`, filename: svc },
    { code: `app.post("/v1/orders", { config: { idempotent: false } }, handler);`, filename: svc },
    { code: `app.get("/v1/orders", { schema: {} }, handler);`, filename: svc },
    { code: `app.route({ method: "GET", url: "/v1/orders", handler });`, filename: svc },
    { code: `app.route({ method: "POST", url: "/v1/orders", ${withHeader}, handler });`, filename: svc },
    { code: `const Headers = z.object({ "idempotency-key": z.string() }); app.post("/v1/orders", { schema: { headers: Headers } }, handler);`, filename: svc },
    { code: `app.post("/v1/orders", { schema: { headers: OrderRoutes.create.headers } }, handler);`, filename: svc },
    { code: `app.post(path, { schema: {} }, handler);`, filename: svc },
    { code: `app.post("/v1/orders", { schema: {} }, handler);`, filename: infra },
    { code: `app.post("/v1/orders", { schema: {} }, handler);`, filename: app },
  ],
  invalid: [
    { code: `app.post("/v1/orders", { schema: { body: Body } }, handler);`, filename: svc, errors: [{ messageId: "missingHeader", data: { method: "POST", path: "/v1/orders" } }] },
    { code: `app.post("/v1/orders", handler);`, filename: svc, errors: [{ messageId: "missingHeader" }] },
    { code: `app.put("/v1/orders/:id", { schema: { headers: z.object({ "x-tenant-id": z.string() }) } }, handler);`, filename: svc, errors: [{ messageId: "missingHeader", data: { method: "PUT", path: "/v1/orders/:id" } }] },
    { code: `app.post("/v1/orders", { config: { idempotent: true }, schema: {} }, handler);`, filename: svc, errors: [{ messageId: "missingHeader" }] },
    { code: `app.route({ method: "POST", url: "/v1/orders", handler });`, filename: svc, errors: [{ messageId: "missingHeader" }] },
    { code: `app.route({ method: ["GET", "PUT"], url: "/v1/orders/:id", schema: {} });`, filename: svc, errors: [{ messageId: "missingHeader", data: { method: "PUT", path: "/v1/orders/:id" } }] },
    { code: `const Headers = z.object({ "x-tenant-id": z.string() }); app.post("/v1/orders", { schema: { headers: Headers } }, handler);`, filename: svc, errors: [{ messageId: "missingHeader" }] },
    { code: `app.post("/v1/orders", { schema: {} }, handler);`, filename: "/repo/packages/services/orders/src/variants/golden/routes.ts", errors: [{ messageId: "missingHeader" }] },
  ],
});
