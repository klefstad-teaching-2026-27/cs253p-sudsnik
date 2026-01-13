import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

const roots = ["packages", "packages/infra", "packages/services", "apps", "tools"];
const projects: string[] = [];
for (const root of roots) {
  if (!existsSync(root)) continue;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "test"))) projects.push(dir);
  }
}

export default defineConfig({
  test: {
    projects: projects.map((dir) => ({
      test: { name: dir.split("/").pop()!, root: dir, include: ["test/**/*.test.ts"] },
    })),
  },
});
