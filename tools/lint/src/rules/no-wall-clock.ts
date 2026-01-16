import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";
import { isIdentifier, memberName } from "../ast.js";
import { inAnyDir, inSrc, inTest } from "../paths.js";
import { createRule } from "../rule.js";

const EXEMPT = ["packages/infra", "packages/external", "apps", "tools"];

type MessageIds = "dateNow" | "newDate" | "literalTimer";

export const noWallClock = createRule<[], MessageIds>({
  name: "no-wall-clock",
  meta: {
    type: "problem",
    docs: { description: "Domain code takes time from the injected clock, never the wall clock (system-spec §5.1 item 4)." },
    schema: [],
    messages: {
      dateNow: "Date.now() reads the wall clock; use deps.clock.now().",
      newDate: "new Date() reads the wall clock; use deps.clock.now().",
      literalTimer: "{{name}} with a literal delay runs on wall time; use deps.clock.after() or deps.clock.every().",
    },
  },
  defaultOptions: [],
  create(context) {
    const file = context.filename;
    if (!inSrc(file) || inTest(file) || inAnyDir(file, EXEMPT)) return {};
    return {
      CallExpression(node: TSESTree.CallExpression) {
        const callee = node.callee;
        if (callee.type === AST_NODE_TYPES.MemberExpression && isIdentifier(callee.object, "Date") && memberName(callee) === "now") {
          context.report({ node, messageId: "dateNow" });
          return;
        }
        const name = isIdentifier(callee) ? callee.name : callee.type === AST_NODE_TYPES.MemberExpression && isIdentifier(callee.object, "globalThis") ? memberName(callee) : undefined;
        if (name !== "setTimeout" && name !== "setInterval") return;
        const delay = node.arguments[1];
        if (delay?.type === AST_NODE_TYPES.Literal && typeof delay.value === "number") context.report({ node, messageId: "literalTimer", data: { name } });
      },
      NewExpression(node: TSESTree.NewExpression) {
        if (isIdentifier(node.callee, "Date") && node.arguments.length === 0) context.report({ node, messageId: "newDate" });
      },
    };
  },
});
