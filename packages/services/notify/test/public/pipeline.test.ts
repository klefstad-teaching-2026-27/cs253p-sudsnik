import { describe, expect, it } from "vitest";
import { fail, halt, next, pipeline, stage, type StageEvent } from "../../src/pipeline.js";

interface S {
  trail: string[];
}

const step = (name: string) => stage<S>(name, (s) => next({ trail: [...s.trail, name] }));

describe("pipeline", () => {
  it("runs stages in order and hands each the previous state", async () => {
    const run = pipeline<S>("p", [step("a"), step("b"), step("c")]);
    const out = await run({ trail: [] });
    expect(out).toEqual({ kind: "next", state: { trail: ["a", "b", "c"] } });
  });

  it("stops at a halt and reports it to the observer", async () => {
    const events: StageEvent[] = [];
    const run = pipeline<S>("p", [step("a"), stage("stop", () => halt("seen before")), step("never")], (e) => events.push(e));
    const out = await run({ trail: [] });
    expect(out).toEqual({ kind: "halt", reason: "seen before" });
    expect(events.map((e) => `${e.stage}:${e.kind}`)).toEqual(["a:next", "stop:halt"]);
  });

  it("stops at a failure", async () => {
    const run = pipeline<S>("p", [stage("boom", () => fail({ code: "INVALID", message: "bad", retryable: false })), step("never")]);
    const out = await run({ trail: [] });
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") expect(out.error.code).toBe("INVALID");
  });

  it("turns a thrown error into a retryable INTERNAL failure naming the stage", async () => {
    const run = pipeline<S>("p", [
      stage("throws", () => {
        throw new Error("kaboom");
      }),
    ]);
    const out = await run({ trail: [] });
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") {
      expect(out.error.code).toBe("INTERNAL");
      expect(out.error.retryable).toBe(true);
      expect(out.error.message).toBe("p/throws: kaboom");
    }
  });

  it("accepts async stages", async () => {
    const run = pipeline<S>("p", [stage("later", async (s) => next({ trail: [...s.trail, "later"] }))]);
    expect(await run({ trail: [] })).toEqual({ kind: "next", state: { trail: ["later"] } });
  });

  it("returns the initial state when there are no stages", async () => {
    expect(await pipeline<S>("p", [])({ trail: ["x"] })).toEqual({ kind: "next", state: { trail: ["x"] } });
  });
});
