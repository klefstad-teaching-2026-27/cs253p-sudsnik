import { z } from "zod";
import { err, ok, sudsnikError, type Result } from "@sudsnik/kernel";
import { Action, Severity } from "@sudsnik/contracts/mocks/oracle";

/** The category set of system-spec §7.1. */
export const CATEGORIES = ["contamination", "damage", "moisture", "odor", "other", "sensor", "stain"] as const;
export type Category = (typeof CATEGORIES)[number];

export const TriageFields = z.object({ category: z.enum(CATEGORIES), severity: Severity, action: Action });
export type TriageFields = z.infer<typeof TriageFields>;

/** The JSON object in a completion, tolerating prose around it; the strict retry prompt handles the rest. */
function jsonObjectIn(completion: string): unknown {
  const start = completion.indexOf("{");
  const end = completion.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(completion.slice(start, end + 1)) as unknown;
  } catch {
    return undefined;
  }
}

export function parseTriage(completion: string): Result<TriageFields> {
  const candidate = jsonObjectIn(completion);
  if (candidate === undefined) return err(sudsnikError("INVALID", "completion holds no JSON object"));
  const parsed = TriageFields.safeParse(candidate);
  if (!parsed.success) return err(sudsnikError("INVALID", `completion is not a triage: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`));
  return ok(parsed.data);
}
