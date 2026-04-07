import { HABITATS, isHabitatVisible, nextWindowStart } from "@sudsnik/contracts";
import type { SudsnikError } from "@sudsnik/kernel";

export function isKnownHabitat(habitatId: string): boolean {
  return HABITATS.includes(habitatId);
}

export function inLinkWindow(habitatId: string, now: number): boolean {
  return isHabitatVisible(habitatId, now);
}

export function nextWindow(habitatId: string, now: number): number {
  return nextWindowStart(habitatId, now);
}

/** The hold relay asked for with `Retry-After` (seconds), as simulated ms; undefined when the error carries none. */
export function retryAfterMs(error: SudsnikError): number | undefined {
  const cause = error.cause as { headers?: Record<string, string> } | undefined;
  const raw = cause?.headers?.["retry-after"];
  if (raw === undefined) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : undefined;
}
