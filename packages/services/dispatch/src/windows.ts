import { LINK_WINDOW_MINUTES, MINUTE_MS, ORBIT_MS, nextWindowStart, type Ctx, type EphemerisClient } from "@sudsnik/contracts";
import type { Window } from "@sudsnik/contracts/mocks/ephemeris";
import type { Cache } from "@sudsnik/infra-cache";
import { ok, type Result } from "@sudsnik/kernel";

export const LINK_WINDOW_MS = LINK_WINDOW_MINUTES * MINUTE_MS;

/** Where the next link window of a habitat comes from; variants differ in caching and in what happens when `ephemeris` fails. */
export interface WindowSource {
  next(habitatId: string, nowMs: number, ctx: Ctx): Promise<Result<Window>>;
}

/** The canon schedule (contracts `nextWindowStart`), used when `ephemeris` cannot be asked. */
export function canonWindow(habitatId: string, nowMs: number): Window {
  const startMs = nextWindowStart(habitatId, nowMs);
  return { startMs, endMs: startMs + LINK_WINDOW_MS };
}

/** The first window starting at or after `nowMs`; a window already in progress is too late to launch into. */
export function firstWindowFrom(windows: readonly Window[], nowMs: number): Window | undefined {
  return windows.find((w) => w.startMs >= nowMs);
}

/** One `/windows` call per lookup; an error is the caller's problem. */
export function liveWindows(client: EphemerisClient): WindowSource {
  return {
    async next(habitatId, nowMs, ctx) {
      const r = await client.windows(habitatId, ctx);
      if (!r.ok) return r;
      return ok(firstWindowFrom(r.value.windows, nowMs) ?? canonWindow(habitatId, nowMs));
    },
  };
}

/** The three windows `ephemeris` returns are kept per habitat for one orbit; a failed refresh falls back to canon. */
