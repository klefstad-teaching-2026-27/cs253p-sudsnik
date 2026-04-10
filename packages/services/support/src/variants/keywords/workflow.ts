import type { TriageWorkflow } from "@sudsnik/contracts/services/support";
import { ok } from "@sudsnik/kernel";
import { classifyByKeywords } from "../../workflow/keywords.js";

/** The starter: the keyword table alone, no oracle, no tokens. */
export function createKeywordWorkflow(): TriageWorkflow {
  return {
    async classify(input) {
      return ok({ ...classifyByKeywords(input.note), tokens: 0, guarded: false });
    },
  };
}
