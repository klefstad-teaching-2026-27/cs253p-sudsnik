import type { Hold, HoldStore } from "@sudsnik/contracts/services/washnodes";
import { err, ok, sudsnikError, type Result } from "@sudsnik/kernel";

/** A stored hold always carries the firmware's own reference to it: the v1 hold token or the v2 hold id. */
export interface StoredHold extends Hold {
  firmwareRef: string;
}

export type AcquireInput = Parameters<HoldStore["acquire"]>[0];

export function isPastExpiry(hold: Hold, nowMs: number): boolean {
  return hold.expiresAt <= nowMs;
}

/** The transition guard every store applies: the caller's version must match and the hold must still be held. */
export function guardTransition(hold: StoredHold | undefined, holdId: string, expectedVersion: number): Result<StoredHold> {
  if (!hold) return err(sudsnikError("NOT_FOUND", `no hold ${holdId}`));
  if (hold.version !== expectedVersion) return err(sudsnikError("CONFLICT", `hold ${holdId} is at version ${hold.version}, not ${expectedVersion}`));
  if (hold.state !== "held") return err(sudsnikError("CONFLICT", `hold ${holdId} is ${hold.state}`));
  return ok(hold);
}

/** The firmware reference a hold must carry to be released or started at the washer; `what` names the hold in the error. */
export function firmwareRefOf(firmwareRef: string | undefined, what: string): Result<string> {
  return firmwareRef ? ok(firmwareRef) : err(sudsnikError("INTERNAL", `${what} has no firmware reference`));
}
