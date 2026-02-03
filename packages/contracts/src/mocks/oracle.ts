import { z } from "zod";

export const CompleteRequest = z.object({ prompt: z.string().min(1), maxTokens: z.number().int().positive().max(4096) });
export const CompleteResponse = z.object({
  completion: z.string(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  fixture: z.string().optional(),
});
export const UsageResponse = z.object({
  byTenant: z.record(z.string(), z.object({ promptTokens: z.number().int(), completionTokens: z.number().int(), calls: z.number().int() })),
});
export const Severity = z.enum(["low", "medium", "high"]);
export const Action = z.enum(["clean", "inspect", "quarantine", "escalate"]);
export const Fixture = z.object({
  note: z.string().min(1),
  completion: z.string(),
  expected: z.object({ category: z.string().min(1), severity: Severity, action: Action }),
  injected: z.boolean(),
});
export type Fixture = z.infer<typeof Fixture>;
export type CompleteResponse = z.infer<typeof CompleteResponse>;
export const REFUSAL_COMPLETION = '{"category":"unknown","severity":"low","action":"inspect","reason":"I cannot classify this note."}';
