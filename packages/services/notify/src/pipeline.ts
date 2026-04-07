import type { SudsnikError } from "@sudsnik/kernel";

/** What one stage decided: carry on with a new state, stop cleanly, or stop with an error. */
export type Outcome<S> = { kind: "next"; state: S } | { kind: "halt"; reason: string } | { kind: "fail"; error: SudsnikError };

export interface Stage<S> {
  name: string;
  run(state: S): Outcome<S> | Promise<Outcome<S>>;
}

export const next = <S>(state: S): Outcome<S> => ({ kind: "next", state });
export const halt = <S>(reason: string): Outcome<S> => ({ kind: "halt", reason });
export const fail = <S>(error: SudsnikError): Outcome<S> => ({ kind: "fail", error });

export function stage<S>(name: string, run: Stage<S>["run"]): Stage<S> {
  return { name, run };
}

export interface StageEvent {
  pipeline: string;
  stage: string;
  kind: Outcome<unknown>["kind"];
  detail?: string;
}

export type Pipeline<S> = (state: S) => Promise<Outcome<S>>;

/** Runs the stages in order, feeding each the previous state; the first halt or fail ends the run. */
export function pipeline<S>(name: string, stages: Stage<S>[], observe?: (event: StageEvent) => void): Pipeline<S> {
  return async (initial) => {
    let state = initial;
    for (const s of stages) {
      let outcome: Outcome<S>;
      try {
        outcome = await s.run(state);
      } catch (e) {
        outcome = fail({ code: "INTERNAL", message: `${name}/${s.name}: ${e instanceof Error ? e.message : String(e)}`, retryable: true, cause: e });
      }
      observe?.({ pipeline: name, stage: s.name, kind: outcome.kind, detail: outcome.kind === "halt" ? outcome.reason : outcome.kind === "fail" ? outcome.error.message : undefined });
      if (outcome.kind !== "next") return outcome;
      state = outcome.state;
    }
    return next(state);
  };
}
