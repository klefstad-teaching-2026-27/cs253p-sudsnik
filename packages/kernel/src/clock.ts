export type Stop = () => void;

export interface Clock {
  now(): number;
  after(ms: number): Promise<void>;
  every(ms: number, fn: () => void): Stop;
}

interface Waiter {
  at: number;
  resolve: () => void;
}

interface Repeater {
  next: number;
  every: number;
  fn: () => void;
  stopped: boolean;
}

/**
 * A clock advanced only by `advanceTo`, which the tick consumer in infra/queue calls; `after` and
 * `every` resolve at tick granularity, so an `after(2000)` resolves at the first tick at or past now + 2000.
 */
export class SimClock implements Clock {
  private current = 0;
  private waiters: Waiter[] = [];
  private repeaters: Repeater[] = [];

  now(): number {
    return this.current;
  }

  after(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiters.push({ at: this.current + ms, resolve });
    });
  }

  every(ms: number, fn: () => void): Stop {
    if (ms <= 0) throw new RangeError("every(ms) needs ms > 0");
    const r: Repeater = { next: this.current + ms, every: ms, fn, stopped: false };
    this.repeaters.push(r);
    return () => {
      r.stopped = true;
      this.repeaters = this.repeaters.filter((x) => x !== r);
    };
  }

  advanceTo(ms: number): void {
    if (ms < this.current) return;
    this.current = ms;
    const due = this.waiters.filter((w) => w.at <= ms);
    this.waiters = this.waiters.filter((w) => w.at > ms);
    for (const w of due) w.resolve();
    // One process hosts many services in --single, and they share this clock. A repeater that throws must not
    // cost the rest of them their tick, so every repeater runs and the first failure is raised afterwards.
    let failure: unknown;
    for (const r of [...this.repeaters]) {
      while (!r.stopped && r.next <= ms) {
        r.next += r.every;
        try {
          r.fn();
        } catch (e) {
          failure ??= e;
        }
      }
    }
    if (failure !== undefined) throw failure;
  }
}
