import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { repoRoot } from "@sudsnik/cli";

export interface BandThresholds {
  /** Full credit at or better than the midpoint between the two measured ends, rounded away from strictness (§7.2). */
  full: number;
  half: number;
  zero: number;
  lowerIsBetter: boolean;
  /** The measured ends the three thresholds are derived from, so the derivation can be checked. */
  golden?: number;
  /** The worse end: the naive variant's figure unless `worseVariant` names the variant that was measured instead. */
  naive?: number;
  worseVariant?: string;
}

/** Which run a row was measured on: a week's two graded stages are not the same run (autograder-spec.md §2). */
export type BandStage = "canary" | "production";

/**
 * Thresholds per assignment and stage. A week pins a scenario, a scale, and a seam set, but it pins them per stage
 * rather than once: every week's canary runs `quiet-orbit` at scale 1, and only production runs the week's own
 * scenario at its own scale, over the seams that stage submits. A row measured on one stage cannot judge the other.
 *
 * A row is keyed `<assignment>/<stage>` where the stage was measured on its own, and by the bare `<assignment>`
 * where one measurement serves both. `thresholdsFor` resolves the two, so an assignment with no stage row of its
 * own is judged exactly as it was before either existed.
 */
export type BandsFile = Record<string, Record<string, BandThresholds>>;

/**
 * Where a stage's row lives. Production keeps the bare assignment id: that is what the calibrated file has always
 * held, and giving it a suffix would restate every existing row without remeasuring one of them.
 */
export function bandKey(assignment: string, stage: BandStage): string {
  return stage === "production" ? assignment : `${assignment}/${stage}`;
}

/**
 * The thresholds a stage is judged by: its own row, or the assignment's shared row where it has none, and
 * `undefined` where the file holds neither.
 *
 * An absent row and an empty one are different answers and must not collapse into one here. No row at all is a
 * stage nobody has calibrated, and an uncalibrated band scores half. An empty row is a stage that was calibrated
 * and separated nothing (`autograder-spec.md` §7.2): the two ends were measured and no student can move a band
 * between them, so the band keeps its weight instead. `scoreItems` tells them apart by whether the row is there.
 */
export function thresholdsFor(bands: BandsFile, assignment: string, stage: BandStage): Record<string, BandThresholds> | undefined {
  return bands[`${assignment}/${stage}`] ?? bands[assignment];
}

export const BANDS_PATH = join("tools", "fixtures", "bands.yaml");

export function bandsPath(root = repoRoot()): string {
  return join(root, BANDS_PATH);
}

export function loadBands(root = repoRoot()): BandsFile {
  const path = bandsPath(root);
  if (!existsSync(path)) return {};
  return (parse(readFileSync(path, "utf8")) as BandsFile | null) ?? {};
}

/**
 * Full credit, half, or none, on a scale where `full` and `zero` are measured rather than guessed.
 * A value of `undefined` is unmeasured, which scores nothing: absent and perfect must never be the same answer.
 * Every band is a non-negative quantity, so a negative one is a sentinel or a bug and is unmeasured too.
 */
export function scoreBand(value: number | undefined, t: BandThresholds, weight: number): number {
  if (!isMeasured(value)) return 0;
  const meets = (threshold: number) => (t.lowerIsBetter ? value <= threshold : value >= threshold);
  if (meets(t.full)) return weight;
  if (meets(t.half)) return weight / 2;
  return 0;
}

/** Whether a band carries a measurement: present, finite, and not negative. */
export function isMeasured(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}
