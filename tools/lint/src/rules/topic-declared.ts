import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";
import { TOPICS } from "@sudsnik/contracts/topics";
import { findProperty, isIdentifier, memberName, stringValue } from "../ast.js";
import { createRule } from "../rule.js";

const declared: ReadonlySet<string> = new Set(TOPICS);

type MessageIds = "unknownTopic";

function topicOfObjectArg(arg: TSESTree.Node | undefined): TSESTree.Node | undefined {
  if (arg?.type !== AST_NODE_TYPES.ObjectExpression) return undefined;
  return findProperty(arg, "topic")?.value;
}

export const topicDeclared = createRule<[], MessageIds>({
  name: "topic-declared",
  meta: {
    type: "problem",
    docs: { description: "A published or subscribed topic literal is one that contracts/src/topics.ts exports (system-spec §5.1 item 6)." },
    schema: [],
    messages: { unknownTopic: "\"{{topic}}\" is not a topic in contracts/src/topics.ts." },
  },
  defaultOptions: [],
  create(context) {
    function check(node: TSESTree.Node | undefined): void {
      const topic = stringValue(node);
      if (node && topic !== undefined && !declared.has(topic)) context.report({ node, messageId: "unknownTopic", data: { topic } });
    }
    return {
      CallExpression(node: TSESTree.CallExpression) {
        const callee = node.callee;
        if (isIdentifier(callee, "makeEnvelope")) {
          check(topicOfObjectArg(node.arguments[0]));
          return;
        }
        if (callee.type !== AST_NODE_TYPES.MemberExpression) return;
        const method = memberName(callee);
        if (method === "publish") check(topicOfObjectArg(node.arguments[0]));
        else if (method === "subscribe") check(node.arguments[0]);
      },
    };
  },
});
