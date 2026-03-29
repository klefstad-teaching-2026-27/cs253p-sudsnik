import { err, sudsnikError, type Result, type SudsnikError } from "@sudsnik/kernel";

/**
 * The drain of system-spec §5.1 item 8. Every way into this service — a route, a bus delivery, a timer tick — runs its
 * work through the gate, so `close()` can refuse what has not started and wait for what has. The database close is
 * registered before the gate (stops run in reverse), so it runs after the last tracked write has finished.
 */
export interface Gate {
  /** False once the drain has begun; a pass already running reads it to stop looping. */
  isOpen(): boolean;
  /** Runs work that answers with a Result; UNAVAILABLE once the gate is closed. */
  run<T>(work: () => Promise<Result<T>>): Promise<Result<T>>;
  /** Runs work with no answer to carry, such as a sweep; it simply does not start once the gate is closed. */
  sweep(work: () => Promise<void>): Promise<void>;
  /** Refuses new work, then resolves once everything already running has finished. */
  close(): Promise<void>;
}

function draining(): SudsnikError {
  return sudsnikError("UNAVAILABLE", "dispatch is draining");
}

export function createGate(): Gate {
  const running = new Set<Promise<void>>();
  let open = true;

  function track<T>(work: () => Promise<T>): Promise<T> {
    const p = work();
    const settled = p.then(
      () => undefined,
      () => undefined,
    );
    running.add(settled);
    void settled.then(() => void running.delete(settled));
    return p;
  }

  return {
    isOpen: () => open,
    async run(work) {
      if (!open) return err(draining());
      return track(work);
    },
    async sweep(work) {
      if (!open) return;
      await track(work);
    },
    async close() {
      open = false;
      // Work in flight may start more work of its own, so the wait repeats until nothing is left.
      while (running.size > 0) await Promise.all([...running]);
    },
  };
}
