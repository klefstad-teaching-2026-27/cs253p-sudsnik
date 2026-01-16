import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";
import { isIdentifier, memberName, MODULE_SOURCE_SELECTOR, moduleSource } from "../ast.js";
import { inAnyDir } from "../paths.js";
import { createRule } from "../rule.js";

const RAW_MODULES = new Set(["undici", "http", "https", "node:http", "node:https"]);
const DEFAULT_EXEMPT = ["packages/clients", "packages/external", "apps", "tools", "packages/infra/http"];

type Options = [{ exempt?: string[] }];
type MessageIds = "rawModule" | "globalFetch";

export const meteredClientsOnly = createRule<Options, MessageIds>({
  name: "metered-clients-only",
  meta: {
    type: "problem",
    docs: { description: "Outbound calls go through the injected, metered clients of packages/clients (system-spec §5.1 item 5)." },
    schema: [
      {
        type: "object",
        properties: { exempt: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      rawModule: "\"{{source}}\" is a raw transport; call through deps.clients.",
      globalFetch: "fetch is a raw transport; call through deps.clients.",
    },
  },
  defaultOptions: [{ exempt: DEFAULT_EXEMPT }],
  create(context, [options]) {
    if (inAnyDir(context.filename, options.exempt ?? DEFAULT_EXEMPT)) return {};
    return {
      [MODULE_SOURCE_SELECTOR](node: TSESTree.Node) {
        const source = moduleSource(node);
        if (source !== undefined && RAW_MODULES.has(source)) context.report({ node, messageId: "rawModule", data: { source } });
      },
      MemberExpression(node: TSESTree.MemberExpression) {
        if (isIdentifier(node.object, "globalThis") && memberName(node) === "fetch") context.report({ node, messageId: "globalFetch" });
      },
      "Program:exit"() {
        const global = context.sourceCode.scopeManager?.globalScope;
        if (!global) return;
        const refs = [...global.through, ...(global.set.get("fetch")?.references ?? [])];
        for (const ref of refs) {
          if (ref.identifier.name !== "fetch" || ref.identifier.type !== AST_NODE_TYPES.Identifier) continue;
          context.report({ node: ref.identifier, messageId: "globalFetch" });
        }
      },
    };
  },
});
