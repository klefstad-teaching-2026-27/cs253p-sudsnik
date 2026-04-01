import type { Ctx } from "@sudsnik/contracts";
import type { Result } from "@sudsnik/kernel";
import type { CycleOutcome } from "../domain/cycle.js";
import type { Firmware } from "../domain/washer.js";

export interface FirmwareHold {
  /** What the firmware wants back to start or release: the v1 hold token or the v2 hold id. */
  ref: string;
  expiresAt: number;
}

/** One washer firmware generation, as the use cases see it. */
export interface FirmwareAdapter {
  readonly firmware: Firmware;
  hold(washerId: string, ctx: Ctx): Promise<Result<FirmwareHold>>;
  release(washerId: string, ref: string, ctx: Ctx): Promise<Result<void>>;
  start(washerId: string, ref: string, ctx: Ctx): Promise<Result<{ cycleId: string; startedAt: number }>>;
  observe(washerId: string, cycleId: string, ctx: Ctx): Promise<Result<CycleOutcome>>;
}

export type FirmwareAdapters = Record<Firmware, FirmwareAdapter>;
