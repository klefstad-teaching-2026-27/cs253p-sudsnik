import type { TSESLint } from "@typescript-eslint/utils";
import { envViaReadEnv } from "./rules/env-via-read-env.js";
import { idempotencyKeyOnWrites } from "./rules/idempotency-key-on-writes.js";
import { meteredClientsOnly } from "./rules/metered-clients-only.js";
import { noCrossVariantImport } from "./rules/no-cross-variant-import.js";
import { noWallClock } from "./rules/no-wall-clock.js";
import { tenantFieldRequired } from "./rules/tenant-field-required.js";
import { topicDeclared } from "./rules/topic-declared.js";

export const rules = {
  "no-wall-clock": noWallClock,
  "metered-clients-only": meteredClientsOnly,
  "tenant-field-required": tenantFieldRequired,
  "no-cross-variant-import": noCrossVariantImport,
  "env-via-read-env": envViaReadEnv,
  "topic-declared": topicDeclared,
  "idempotency-key-on-writes": idempotencyKeyOnWrites,
};

const plugin = {
  meta: { name: "sudsnik", version: "1.0.0" },
  rules,
  configs: {} as { recommended: TSESLint.FlatConfig.Config },
};

plugin.configs.recommended = {
  plugins: { sudsnik: plugin },
  rules: Object.fromEntries(Object.keys(rules).map((name) => [`sudsnik/${name}`, "error"])),
};

export const configs = plugin.configs;
export default plugin;
