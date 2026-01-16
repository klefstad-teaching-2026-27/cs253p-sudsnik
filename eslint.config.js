import tsParser from "@typescript-eslint/parser";
import { register } from "tsx/esm/api";

// Node 20 cannot import TypeScript, and the plugin is TypeScript; tsx is registered only while loading it.
const unregister = register();
const { default: sudsnik } = await import("./tools/lint/src/index.ts");
await unregister();

export default [
  { ignores: ["**/node_modules/**", "**/out/**", ".reference/**"] },
  {
    // The grader's vitest wrapper is the one file here that is not TypeScript, and the house rules hold for it too.
    files: ["**/*.ts", "**/*.mjs"],
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
    plugins: { sudsnik },
    rules: {
      ...sudsnik.configs.recommended.rules,
      "no-unused-vars": "off",
      "no-debugger": "error",
      eqeqeq: "error",
      "no-var": "error",
      "prefer-const": "error",
    },
  },
];
