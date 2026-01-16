import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";
import { findProperty, hasSpread, propertyName, zodObjectShape } from "../ast.js";
import { createRule } from "../rule.js";

const ENVELOPE = "EnvelopeSchema";

type Options = [{ rowPattern?: string; allow?: string[] }];
type MessageIds = "missingTenant";

/** The name a `z.object(...)` call is bound to, through a chain such as `z.object({}).strict()`. */
function boundName(call: TSESTree.CallExpression): string | undefined {
  let node: TSESTree.Node = call;
  for (;;) {
    const parent: TSESTree.Node | undefined = node.parent;
    if (!parent) return undefined;
    if (parent.type === AST_NODE_TYPES.MemberExpression && parent.object === node) node = parent;
    else if (parent.type === AST_NODE_TYPES.CallExpression && parent.callee === node) node = parent;
    else if (parent.type === AST_NODE_TYPES.VariableDeclarator && parent.init === node) return parent.id.type === AST_NODE_TYPES.Identifier ? parent.id.name : undefined;
    else if (parent.type === AST_NODE_TYPES.Property && parent.value === node) return propertyName(parent);
    else return undefined;
  }
}

export const tenantFieldRequired = createRule<Options, MessageIds>({
  name: "tenant-field-required",
  meta: {
    type: "problem",
    docs: { description: "A persisted-row schema and the envelope schema carry tenantId (system-spec §5.4, §5.5)." },
    schema: [
      {
        type: "object",
        properties: {
          rowPattern: { type: "string" },
          allow: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: { missingTenant: "{{name}} is a persisted-row schema without a tenantId field." },
  },
  defaultOptions: [{ rowPattern: "Row$", allow: [] }],
  create(context, [options]) {
    const rowPattern = new RegExp(options.rowPattern ?? "Row$");
    const allow = new Set(options.allow ?? []);
    return {
      CallExpression(node: TSESTree.CallExpression) {
        const shape = zodObjectShape(node);
        if (!shape) return;
        const name = boundName(node);
        if (name === undefined || allow.has(name)) return;
        if (name !== ENVELOPE && !rowPattern.test(name)) return;
        if (findProperty(shape, "tenantId") || hasSpread(shape)) return;
        context.report({ node, messageId: "missingTenant", data: { name } });
      },
    };
  },
});
