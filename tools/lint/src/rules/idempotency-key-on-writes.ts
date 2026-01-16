import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";
import { findProperty, memberName, stringValue, zodObjectShape } from "../ast.js";
import { inAnyDir } from "../paths.js";
import { createRule } from "../rule.js";

const HEADER = "idempotency-key";
const WRITE_METHODS = new Set(["POST", "PUT"]);
const CALLBACK_PREFIX = "/callbacks/";

type MessageIds = "missingHeader";

interface Route {
  method: string;
  path: string;
  options: TSESTree.ObjectExpression | undefined;
}

function objectArg(node: TSESTree.Node | undefined): TSESTree.ObjectExpression | undefined {
  return node?.type === AST_NODE_TYPES.ObjectExpression ? node : undefined;
}

/** The POST or PUT methods named by `method: "POST"` or `method: ["GET", "POST"]`. */
function writeMethods(node: TSESTree.Node | undefined): string[] {
  const one = stringValue(node)?.toUpperCase();
  if (one !== undefined) return WRITE_METHODS.has(one) ? [one] : [];
  if (node?.type !== AST_NODE_TYPES.ArrayExpression) return [];
  return node.elements.flatMap((e) => writeMethods(e ?? undefined));
}

function routesOf(node: TSESTree.CallExpression): Route[] {
  if (node.callee.type !== AST_NODE_TYPES.MemberExpression) return [];
  const method = memberName(node.callee)?.toLowerCase();
  if (method === "post" || method === "put") {
    const path = stringValue(node.arguments[0]);
    return path === undefined ? [] : [{ method: method.toUpperCase(), path, options: objectArg(node.arguments[1]) }];
  }
  if (method !== "route") return [];
  const options = objectArg(node.arguments[0]);
  if (!options) return [];
  const path = stringValue(findProperty(options, "url")?.value);
  if (path === undefined) return [];
  return writeMethods(findProperty(options, "method")?.value).map((m) => ({ method: m, path, options }));
}

export const idempotencyKeyOnWrites = createRule<[], MessageIds>({
  name: "idempotency-key-on-writes",
  meta: {
    type: "problem",
    docs: { description: "Every POST or PUT route of a service declares an Idempotency-Key header, except callbacks (system-spec §5.4)." },
    schema: [],
    messages: { missingHeader: "{{method}} {{path}} has no Idempotency-Key header in schema.headers." },
  },
  defaultOptions: [],
  create(context) {
    if (!inAnyDir(context.filename, ["packages/services"])) return {};

    function headersShape(expr: TSESTree.Node | undefined): TSESTree.ObjectExpression | undefined {
      const literal = zodObjectShape(expr);
      if (literal) return literal;
      if (expr?.type !== AST_NODE_TYPES.Identifier) return undefined;
      const variable = context.sourceCode.getScope(expr).references.find((r) => r.identifier === expr)?.resolved;
      const def = variable?.defs[0];
      return def?.type === "Variable" && def.node.init ? zodObjectShape(def.node.init) : undefined;
    }

    /** True when the route declares the header, opts out with `config.idempotent: false`, or uses a headers schema this rule cannot read. */
    function satisfied(options: TSESTree.ObjectExpression | undefined): boolean {
      if (!options) return false;
      const config = objectArg(findProperty(options, "config")?.value);
      const optOut = config && findProperty(config, "idempotent")?.value;
      if (optOut?.type === AST_NODE_TYPES.Literal && optOut.value === false) return true;
      const schema = objectArg(findProperty(options, "schema")?.value);
      const headers = schema && findProperty(schema, "headers")?.value;
      if (!headers) return false;
      const shape = headersShape(headers);
      return shape ? findProperty(shape, HEADER, true) !== undefined : true;
    }

    return {
      CallExpression(node: TSESTree.CallExpression) {
        for (const route of routesOf(node)) {
          if (route.path.startsWith(CALLBACK_PREFIX) || satisfied(route.options)) continue;
          context.report({ node, messageId: "missingHeader", data: { method: route.method, path: route.path } });
        }
      },
    };
  },
});
