import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Order } from "@sudsnik/contracts/services/orders";
import { boot, cancel, headers, place, type Stack } from "../helpers.js";

let stack: Stack;
beforeEach(async () => {
  stack = await boot({ billing: false });
});
afterEach(() => stack.app.sudsnik.drain());

async function list(query: string, tenant = "op1"): Promise<Order[]> {
  const res = await stack.app.inject({ method: "GET", url: `/orders${query}`, headers: headers(tenant) });
  expect(res.statusCode).toBe(200);
  return res.json() as Order[];
}

describe("get", () => {
  it("is 404 for another tenant's order and for an unknown id", async () => {
    const order = await place(stack.app);
    const foreign = await stack.app.inject({ method: "GET", url: `/orders/${order.orderId}`, headers: headers("op2") });
    expect(foreign.statusCode).toBe(404);
    const unknown = await stack.app.inject({ method: "GET", url: "/orders/nope", headers: headers("op1") });
    expect(unknown.statusCode).toBe(404);
    expect((unknown.json() as { code: string }).code).toBe("NOT_FOUND");
  });

  it("does not let another tenant cancel", async () => {
    const order = await place(stack.app);
    expect((await cancel(stack.app, order.orderId, "x", "op2")).statusCode).toBe(404);
  });
});

describe("list", () => {
  // Filtering by a state only a working cancel reaches is in the hidden suite, with the cancel itself.
  it("is tenant-scoped and filters by state and habitat", async () => {
    const a = await place(stack.app, { habitatId: "hab01" });
    const b = await place(stack.app, { habitatId: "hab02", podId: "hab02-p001" });
    await place(stack.app, { habitatId: "hab04", podId: "hab04-p001" }, "op2");
    expect((await list("")).map((o) => o.orderId)).toEqual([a.orderId, b.orderId]);
    expect((await list("?state=placed")).map((o) => o.orderId)).toEqual([a.orderId, b.orderId]);
    expect((await list("?habitatId=hab01")).map((o) => o.orderId)).toEqual([a.orderId]);
    expect((await list("", "op2")).map((o) => o.habitatId)).toEqual(["hab04"]);
    expect(await list("", "op3")).toEqual([]);
  });

  it("pages by limit and cursor in id order", async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await place(stack.app)).orderId);
    const first = await list("?limit=2");
    expect(first.map((o) => o.orderId)).toEqual(ids.slice(0, 2));
    const rest = await list(`?limit=10&cursor=${first[1]!.orderId}`);
    expect(rest.map((o) => o.orderId)).toEqual(ids.slice(2));
    expect((await stack.app.inject({ method: "GET", url: "/orders?limit=0", headers: headers() })).statusCode).toBe(400);
  });
});
