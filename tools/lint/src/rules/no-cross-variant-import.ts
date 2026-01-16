import type { TSESTree } from "@typescript-eslint/utils";
import { MODULE_SOURCE_SELECTOR, moduleSource } from "../ast.js";
import { inSrc, inTest, isSelector, ownVariantDir, packageDir, resolveRelative, toPosix } from "../paths.js";
import { createRule } from "../rule.js";

type MessageIds = "otherPackage" | "otherVariant" | "sharedCode";

export const noCrossVariantImport = createRule<[], MessageIds>({
  name: "no-cross-variant-import",
  meta: {
    type: "problem",
    docs: { description: "A package's variants are its own: never imported from another package, from each other, or from the code they all share (system-spec §8)." },
    schema: [],
    messages: {
      otherPackage: "\"{{source}}\" reaches into another package's variants/; depend on its exported factory instead.",
      otherVariant: "\"{{source}}\" imports a sibling variant; variants never import each other.",
      sharedCode: "\"{{source}}\" names a variant from code every variant shares; only src/index.ts selects one, so the starter can ship one variant alone.",
    },
  },
  defaultOptions: [],
  create(context) {
    const file = toPosix(context.filename);
    return {
      [MODULE_SOURCE_SELECTOR](node: TSESTree.Node) {
        const source = moduleSource(node);
        if (source === undefined) return;
        if (!source.startsWith(".")) {
          if (source.includes("/variants/")) context.report({ node, messageId: "otherPackage", data: { source } });
          return;
        }
        const target = resolveRelative(file, source);
        if (!target.includes("/variants/")) return;
        if (!target.startsWith(`${packageDir(file)}/`)) {
          context.report({ node, messageId: "otherPackage", data: { source } });
          return;
        }
        const own = ownVariantDir(file);
        if (own === undefined) {
          // `src/index.ts` is the selector (§8); any other shipped file would keep a variant the carve removes.
          // Tests may name every variant: they compare them, and they live in the golden tree.
          if (inSrc(file) && !inTest(file) && !isSelector(file)) context.report({ node, messageId: "sharedCode", data: { source } });
          return;
        }
        if (!target.startsWith(`${own}/`)) context.report({ node, messageId: "otherVariant", data: { source } });
      },
    };
  },
});
