import { err, sudsnikError, type Clock, type Result, type SudsnikError } from "@sudsnik/kernel";

export interface RetryOptions {
  attempts: number;
  baseMs: number;
  maxMs?: number;
  /** Deterministic jitter in [0, 1); pass an Rng.float for seeded jitter. */
  jitter?: () => number;
  clock: Clock;
  retryOn?: (e: SudsnikError) => boolean;
}

/** Retries a Result-returning call with exponential backoff on the simulated clock. */
export async function retry<T>(fn: (attempt: number) => Promise<Result<T>>, opts: RetryOptions): Promise<Result<T>> {
  if (opts.attempts < 1) throw new RangeError("attempts must be >= 1");
  const should = opts.retryOn ?? ((e) => e.retryable);
  let last: Result<T> | undefined;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    last = await fn(attempt);
    if (last.ok || !should(last.error) || attempt === opts.attempts) return last;
    const backoff = Math.min(opts.baseMs * 2 ** (attempt - 1), opts.maxMs ?? Number.POSITIVE_INFINITY);
    const jitter = opts.jitter ? opts.jitter() * backoff : 0;
    await opts.clock.after(Math.round(backoff + jitter));
  }
  return last!;
}

/** Fails with TIMEOUT when the simulated clock passes `ms` before the promise settles. */
export async function withTimeout<T>(p: Promise<Result<T>>, ms: number, clock: Clock, what = "call"): Promise<Result<T>> {
  const timer: Promise<Result<T>> = clock.after(ms).then(() => err(sudsnikError("TIMEOUT", `${what} exceeded ${ms} simulated ms`)));
  return Promise.race([p, timer]);
}

export type BreakerState = "closed" | "open" | "half-open";

export interface BreakerOptions {
  failureThreshold: number;
  openMs: number;
  clock: Clock;
  name: string;
  onStateChange?: (from: BreakerState, to: BreakerState) => void;
}

export interface Breaker {
  state(): BreakerState;
  exec<T>(fn: () => Promise<Result<T>>): Promise<Result<T>>;
  failures(): number;
}

/** Circuit breaker: opens after `failureThreshold` consecutive retryable failures; half-open after openMs; one trial call closes or re-opens it. */
export function createBreaker(opts: BreakerOptions): Breaker {
  let state: BreakerState = "closed";
  let failures = 0;
  let openedAt = 0;
  let trialInFlight = false;
  const move = (to: BreakerState) => {
    if (to === state) return;
    const from = state;
    state = to;
    opts.onStateChange?.(from, to);
  };
  return {
    state: () => state,
    failures: () => failures,
    async exec(fn) {
      if (state === "open") {
        if (opts.clock.now() - openedAt >= opts.openMs) move("half-open");
        else return err(sudsnikError("UNAVAILABLE", `breaker ${opts.name} open`));
      }
      if (state === "half-open") {
        if (trialInFlight) return err(sudsnikError("UNAVAILABLE", `breaker ${opts.name} half-open`));
        trialInFlight = true;
      }
      // A call that throws rather than answering must still release the trial, or a half-open breaker refuses
      // every call for the rest of the run.
      let r: Awaited<ReturnType<typeof fn>>;
      try {
        r = await fn();
      } finally {
        trialInFlight = false;
      }
      if (r.ok || !r.error.retryable) {
        failures = 0;
        move("closed");
        return r;
      }
      failures++;
      if (state === "half-open" || failures >= opts.failureThreshold) {
        openedAt = opts.clock.now();
        move("open");
      }
      return r;
    },
  };
}
