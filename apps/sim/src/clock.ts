import { MINUTE_MS, MOCKS, ORBIT_MS, makeEnvelope, type ClockTick, type Envelope, type FaultEvent, type MockName, type SimState } from "@sudsnik/contracts";
import { darkIdsAt } from "./faults/schedule.js";

export interface TickerDeps {
  publish: (envelope: Envelope<ClockTick>) => Promise<void>;
  postState: (mock: MockName, state: SimState) => Promise<void>;
  /** Schedule events active at this absolute orbit; empty in idle mode. Each is addressed to one mock. */
  faultsAt: (orbit: number) => FaultEvent[];
  /** The physical flow, run after the tick is published and every mock knows the state. */
  onStep: (tick: ClockTick, dark: string[]) => Promise<void>;
  /** Virtual clock multiplier (system-spec §5.3); a wall interval of 60_000 / rate ms per simulated minute. */
  clockRate: number;
  mocks?: readonly MockName[];
}

export interface Ticker {
  /** One simulated minute: publish, inform the mocks, step the world. Tests call it directly. */
  tick(): Promise<ClockTick>;
  current(): ClockTick | undefined;
  now(): number;
  start(): void;
  stop(): void;
  running(): boolean;
  /** Mocks whose /_sim/state call failed, with the count, since start. */
  stateFailures(): Record<string, number>;
}

export function tickAt(nowMs: number): ClockTick {
  return { nowMs, orbit: Math.floor(nowMs / ORBIT_MS), orbitPhase: (nowMs % ORBIT_MS) / ORBIT_MS };
}

/** The clock the whole stack runs on (system-spec §6); the first tick is minute 0 of the run. */
export function createTicker(deps: TickerDeps): Ticker {
  const mocks = deps.mocks ?? MOCKS;
  const periodMs = MINUTE_MS / deps.clockRate;
  let last: ClockTick | undefined;
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let inFlight: Promise<ClockTick> | undefined;
  const failures: Record<string, number> = {};

  async function tick(): Promise<ClockTick> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const t = tickAt(last ? last.nowMs + MINUTE_MS : 0);
      await deps.publish(makeEnvelope({ topic: "clock.tick", occurredAt: t.nowMs, payload: t }));
      const faults = deps.faultsAt(t.orbit);
      const dark = darkIdsAt(faults, t.orbit, t.nowMs);
      await Promise.all(
        mocks.map(async (mock) => {
          try {
            await deps.postState(mock, { clockMs: t.nowMs, orbit: t.orbit, dark, faults: faults.filter((f) => f.mock === mock) });
          } catch {
            failures[mock] = (failures[mock] ?? 0) + 1;
          }
        }),
      );
      await deps.onStep(t, dark);
      last = t;
      return t;
    })();
    try {
      return await inFlight;
    } finally {
      inFlight = undefined;
    }
  }

  function schedule(delayMs: number): void {
    timer = setTimeout(() => {
      const started = performance.now();
      void tick()
        .catch(() => undefined)
        .then(() => {
          if (running) schedule(Math.max(0, periodMs - (performance.now() - started)));
        });
    }, delayMs);
  }

  return {
    tick,
    current: () => last,
    now: () => last?.nowMs ?? 0,
    start() {
      if (running) return;
      running = true;
      schedule(0);
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
    running: () => running,
    stateFailures: () => ({ ...failures }),
  };
}
