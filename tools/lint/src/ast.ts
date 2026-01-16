import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

export function stringValue(node: TSESTree.Node | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === AST_NODE_TYPES.Literal && typeof node.value === "string") return node.value;
  if (node.type === AST_NODE_TYPES.TemplateLiteral && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? undefined;
  return undefined;
}

export function propertyName(prop: TSESTree.ObjectLiteralElement): string | undefined {
  if (prop.type !== AST_NODE_TYPES.Property) return undefined;
  if (prop.computed) return stringValue(prop.key);
  if (prop.key.type === AST_NODE_TYPES.Identifier) return prop.key.name;
  return stringValue(prop.key);
}

export function findProperty(obj: TSESTree.ObjectExpression, name: string, caseInsensitive = false): TSESTree.Property | undefined {
  const want = caseInsensitive ? name.toLowerCase() : name;
  for (const p of obj.properties) {
    const n = propertyName(p);
    if (n === undefined) continue;
    if ((caseInsensitive ? n.toLowerCase() : n) === want) return p as TSESTree.Property;
  }
  return undefined;
}

export function hasSpread(obj: TSESTree.ObjectExpression): boolean {
  return obj.properties.some((p) => p.type === AST_NODE_TYPES.SpreadElement);
}

export function isIdentifier(node: TSESTree.Node | undefined, name?: string): node is TSESTree.Identifier {
  return node?.type === AST_NODE_TYPES.Identifier && (name === undefined || node.name === name);
}

export function memberName(node: TSESTree.MemberExpression): string | undefined {
  if (node.computed) return stringValue(node.property);
  return node.property.type === AST_NODE_TYPES.Identifier ? node.property.name : undefined;
}

/** `z.object({...})`, `z.strictObject({...})`, or `z.looseObject({...})`: returns the shape literal. */
export function zodObjectShape(node: TSESTree.Node | undefined): TSESTree.ObjectExpression | undefined {
  if (node?.type !== AST_NODE_TYPES.CallExpression) return undefined;
  const callee = node.callee;
  if (callee.type !== AST_NODE_TYPES.MemberExpression || !isIdentifier(callee.object, "z")) return undefined;
  const method = memberName(callee);
  if (method !== "object" && method !== "strictObject" && method !== "looseObject") return undefined;
  const arg = node.arguments[0];
  return arg?.type === AST_NODE_TYPES.ObjectExpression ? arg : undefined;
}

/** The module specifier of an import declaration, `export ... from`, `require(...)`, or `import(...)`. */
export function moduleSource(node: TSESTree.Node): string | undefined {
  switch (node.type) {
    case AST_NODE_TYPES.ImportDeclaration:
    case AST_NODE_TYPES.ExportNamedDeclaration:
    case AST_NODE_TYPES.ExportAllDeclaration:
      return node.source ? stringValue(node.source) : undefined;
    case AST_NODE_TYPES.ImportExpression:
      return stringValue(node.source);
    case AST_NODE_TYPES.CallExpression:
      return isIdentifier(node.callee, "require") ? stringValue(node.arguments[0]) : undefined;
    default:
      return undefined;
  }
}

export const MODULE_SOURCE_SELECTOR = "ImportDeclaration, ExportNamedDeclaration[source], ExportAllDeclaration, ImportExpression, CallExpression[callee.name='require']";
