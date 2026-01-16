import { ESLintUtils } from "@typescript-eslint/utils";

/** Every house rule is specified in docs/system-spec.md §5.4; the URL is that table. */
export const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/sudsnik/sudsnik/blob/main/docs/system-spec.md#54-house-lint-rules?rule=${name}`,
);
