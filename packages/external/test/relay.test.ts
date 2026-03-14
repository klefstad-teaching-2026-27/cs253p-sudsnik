import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { DeliverRequest } from "@sudsnik/contracts/mocks/relay";
import { createMock, flipChecksum } from "../src/relay/index.js";
import { fault, seedFor, setState, startReceiver, tenant, tmpDir, type Receiver } from "./helpers.js";

const quiet = [fault("relay", "duplicate-rate", { rate: 0 }), fault("relay", "reorder-rate", { rate: 0 })];
const ground = { kind: "ground", id: "dispatch" } as const;

describe("relay", () => {
  let receiver: Receiver;
  let app: FastifyInstance;
  let dataDir: string;
  const deliver = (d: Partial<DeliverRequest>, t = "op1") =>
    app.inject({
      method: "POST",
      url: "/deliver",
      headers: tenant(t),
      payload: { origin: ground, destination: ground, to: receiver.url, path: "/callbacks/relay", body: { id: "m1", checksum: "0123abcd" }, deliverAtMs: 0, ...d },
    });

  beforeAll(async () => {
    receiver = await startReceiver();
    dataDir = tmpDir();
    app = await createMock({ seed: seedFor("relay"), dataDir });
    await setState(app, { clockMs: 0, faults: quiet });
  });
  afterAll(async () => {
    await app.close();
    await receiver.close();
  });

  it("forwards POST <to><path> with the caller's tenant and keeps its table on disk", async () => {
    const res = await deliver({ body: { id: "m1", n: 1 } }, "op3");
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ accepted: true });
    expect(receiver.received).toHaveLength(1);
    expect(receiver.received[0]).toEqual({ path: "/callbacks/relay", tenant: "op3", body: { id: "m1", n: 1 } });
    expect(existsSync(join(dataDir, "mocks", "relay.sqlite"))).toBe(true);
  });

  it("refuses a dark destination with 503 and Retry-After until its next window", async () => {
    const res = await deliver({ destination: { kind: "habitat", id: "hab02" } });
    expect(res.statusCode).toBe(503);
    expect(res.headers["retry-after"]).toBe("450");
    expect(res.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
    const node = await deliver({ destination: { kind: "node", id: "B" } });
    expect(node.statusCode).toBe(202);
    await setState(app, { clockMs: 0, dark: ["B"], faults: quiet });
    expect((await deliver({ destination: { kind: "node", id: "B" } })).statusCode).toBe(503);
    await setState(app, { clockMs: 0, faults: [...quiet, fault("relay", "dark", { kind: "node", id: "C" })] });
    expect((await deliver({ destination: { kind: "node", id: "C" } })).statusCode).toBe(503);
    await setState(app, { clockMs: 0, faults: quiet });
  });

  it("holds a delivery from a dark origin until the origin's next contact", async () => {
    const before = receiver.received.length;
    const res = await deliver({ origin: { kind: "habitat", id: "hab02" }, body: { id: "held" } });
    expect(res.statusCode).toBe(202);
    await setState(app, { clockMs: 5 * 60_000, faults: quiet });
    expect(receiver.received).toHaveLength(before);
    await setState(app, { clockMs: 8 * 60_000, faults: quiet });
    expect(receiver.received).toHaveLength(before + 1);
    expect(receiver.received[before]!.body).toEqual({ id: "held" });
    await setState(app, { clockMs: 9 * 60_000, faults: quiet });
    expect(receiver.received).toHaveLength(before + 1);
  });

  it("records habitat-bound deliveries instead of forwarding them", async () => {
    await setState(app, { clockMs: 0, faults: quiet });
    const before = receiver.received.length;
    const res = await deliver({ destination: { kind: "habitat", id: "hab01" }, body: { notificationId: "n7", text: "pod on its way" } });
    expect(res.statusCode).toBe(202);
    expect(receiver.received).toHaveLength(before);
    const list = await app.inject({ method: "GET", url: "/_sim/deliveries" });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([{ deliveryId: res.json().deliveryId, habitatId: "hab01", notificationId: "n7", deliveredAtMs: 0, body: { notificationId: "n7", text: "pod on its way" } }]);
  });

  it("duplicates, defers, and flips checksums under the matching faults", async () => {
    await setState(app, { clockMs: 0, faults: [fault("relay", "duplicate-rate", { rate: 1 }), fault("relay", "reorder-rate", { rate: 0 })] });
    let before = receiver.received.length;
    await deliver({ body: { id: "dup" } });
    expect(receiver.received.slice(before).map((r) => r.body)).toEqual([{ id: "dup" }, { id: "dup" }]);

    await setState(app, { clockMs: 60_000, faults: [fault("relay", "duplicate-rate", { rate: 0 }), fault("relay", "reorder-rate", { rate: 1 })] });
    before = receiver.received.length;
    await deliver({ body: { id: "late" }, deliverAtMs: 60_000 });
    expect(receiver.received).toHaveLength(before);
    await setState(app, { clockMs: 120_000, faults: quiet });
    await deliver({ body: { id: "early" }, deliverAtMs: 120_000 });
    await setState(app, { clockMs: 180_000, faults: quiet });
    expect(receiver.received.slice(before).map((r) => r.body)).toEqual([{ id: "late" }, { id: "early" }]);

    await setState(app, { clockMs: 240_000, faults: [...quiet, fault("relay", "bitflip-rate", { rate: 1 })] });
    before = receiver.received.length;
    await deliver({ body: { id: "flip", checksum: "0123abcd" } });
    const flipped = receiver.received[before]!.body.checksum as string;
    expect(flipped).toHaveLength(8);
    expect(flipped).not.toBe("0123abcd");
    expect(flipped.split("").filter((c, i) => c !== "0123abcd"[i])).toHaveLength(1);
    expect(flipChecksum('{"checksum":"ffff"}', 0)).toBe('{"checksum":"0fff"}');
    expect(flipChecksum('{"id":"x"}', 0)).toBe('{"id":"x"}');
  });

  it("retries a delivery the receiver refused on later ticks", async () => {
    const down = await startReceiver(500);
    await setState(app, { clockMs: 300_000, faults: quiet });
    await deliver({ to: down.url, body: { id: "retry" } });
    await setState(app, { clockMs: 360_000, faults: quiet });
    expect(down.received.map((r) => r.body)).toEqual([{ id: "retry" }, { id: "retry" }]);
    await down.close();
  });
});
