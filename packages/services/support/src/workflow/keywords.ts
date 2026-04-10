import type { Category, TriageFields } from "./validate.js";

type Severity = TriageFields["severity"];

interface Cue {
  pattern: RegExp;
  category: Category;
  /** Overrides the category's default severity when the cue matches. */
  severity?: Severity;
}

/** Cues are tried in order; the first match names the category. A later cue may only raise severity. */
const CUES: Cue[] = [
  { pattern: /\b(biohazard|syringe|blood|medical dressing|bandage)\b/, category: "contamination", severity: "high" },
  { pattern: /\b(hydraulic|coolant|fuel|powder|mou?ld|shavings|residue)\b/, category: "contamination", severity: "high" },
  { pattern: /\b(insects?|crumbs|wrapper|rag)\b/, category: "contamination", severity: "medium" },
  { pattern: /\b(scorch\w*|cracked|sharp edges)\b/, category: "damage", severity: "high" },
  { pattern: /\b(torn|ripped|tear|puncture\w*|hinge|latch|gasket|jammed|snapped|frayed|does not latch)\b/, category: "damage" },
  { pattern: /\b(rfid|sensor|telemetry|checksum|weight (reading|sensor)|kg over|reading is|cycle log|logged|fault)\b/, category: "sensor" },
  { pattern: /\b(soaking|pooled|saturated|dripping|free water)\b/, category: "moisture", severity: "medium" },
  { pattern: /\b(damp|wet|condensation|moisture)\b/, category: "moisture" },
  { pattern: /\b(burnt|rotten|ammonia|chemical)\b/, category: "odor", severity: "high" },
  { pattern: /\b(smell\w*|odou?r|mildew|musty|sour)\b/, category: "odor" },
  { pattern: /\b(stains?|streaks|discoloration|marks|dye)\b/, category: "stain" },
  { pattern: /\b(wrong node|does not match|swapped|name tag|missing)\b/, category: "other", severity: "medium" },
];

const DEFAULT_SEVERITY: Record<Category, Severity> = { contamination: "medium", damage: "medium", moisture: "low", odor: "low", other: "low", sensor: "low", stain: "low" };
const RAISERS: Array<[RegExp, Severity]> = [
  [/\b(strong|lingered|make eyes water|sharp|every garment|all garments|large|half the contents|no longer|missing)\b/, "medium"],
  [/\b(burnt|scorch\w*|rotten|hot plastic|biohazard|blood|syringe|fuel|cracked)\b/, "high"],
];
const RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2 };

function actionFor(category: Category, severity: Severity, text: string): TriageFields["action"] {
  switch (category) {
    case "contamination":
      return /\b(biohazard|syringe)\b/.test(text) ? "escalate" : severity === "low" ? "clean" : "quarantine";
    case "damage":
      return severity === "high" ? "escalate" : severity === "medium" ? "inspect" : /\b(strap|frayed)\b/.test(text) ? "clean" : "inspect";
    case "sensor":
      return "inspect";
    case "other":
      return severity === "medium" ? "escalate" : /\b(missing|overstuffed|static)\b/.test(text) ? "inspect" : "clean";
    default:
      return severity === "high" ? "escalate" : severity === "medium" ? "inspect" : "clean";
  }
}

/** The starter's classifier: a keyword table over the note. */
export function classifyByKeywords(note: string): TriageFields {
  const text = note.trim().replace(/\s+/g, " ").toLowerCase();
  const hit = CUES.find((c) => c.pattern.test(text));
  const category: Category = hit?.category ?? "other";
  let severity: Severity = hit?.severity ?? DEFAULT_SEVERITY[category];
  for (const [re, s] of RAISERS) if (re.test(text) && RANK[s] > RANK[severity]) severity = s;
  return { category, severity, action: actionFor(category, severity, text) };
}
