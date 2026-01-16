import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";
import { isIdentifier, memberName } from "../ast.js";
import { inAnyDir } from "../paths.js";
import { createRule } from "../rule.js";

const EXEMPT = ["packages/infra", "apps", "tools", "packages/external", "packages/contracts/testing"];
const READ_ENV = "readEnv";

type MessageIds = "outsideReadEnv";

function enclosingFunctionName(node: TSESTree.Node): string | undefined {
  switch (node.type) {
    case AST_NODE_TYPES.FunctionDeclaration:
    case AST_NODE_TYPES.FunctionExpression:
      if (node.id) return node.id.name;
      break;
    case AST_NODE_TYPES.ArrowFunctionExpression:
      break;
    default:
      return undefined;
  }
  const parent = node.parent;
  if (parent?.type === AST_NODE_TYPES.VariableDeclarator && isIdentifier(parent.id)) return parent.id.name;
  if ((parent?.type === AST_NODE_TYPES.MethodDefinition || parent?.type === AST_NODE_TYPES.Property || parent?.type === AST_NODE_TYPES.PropertyDefinition) && !parent.computed && isIdentifier(parent.key)) {
    return parent.key.name;
  }
  return undefined;
}

export const envViaReadEnv = createRule<[], MessageIds>({
  name: "env-via-read-env",
  meta: {
    type: "problem",
    docs: { description: "Configuration is read only inside readEnv(), validated by zod (system-spec §5.1 item 7)." },
    schema: [],
    messages: { outsideReadEnv: "process.env is read outside readEnv(); take configuration from readEnv() or deps.env." },
  },
  defaultOptions: [],
  create(context) {
    if (inAnyDir(context.filename, EXEMPT)) return {};
    return {
      MemberExpression(node: TSESTree.MemberExpression) {
        if (!isIdentifier(node.object, "process") || memberName(node) !== "env") return;
        for (let n: TSESTree.Node | undefined = node.parent; n; n = n.parent) if (enclosingFunctionName(n) === READ_ENV) return;
        context.report({ node, messageId: "outsideReadEnv" });
      },
    };
  },
});
