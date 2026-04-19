import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root, found from this file. */
export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(dir, "vitest.config.ts"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("repository root not found");
}

export interface Child {
  name: string;
  proc: ChildProcess;
  exited: Promise<number | null>;
}

export function spawnTs(name: string, entry: string, env: Record<string, string>, args: string[] = []): Child {
  const proc = spawn(process.execPath, ["--import", "tsx", entry, ...args], { cwd: repoRoot(), env: { ...process.env, ...env }, stdio: ["ignore", "inherit", "inherit"] });
  const exited = new Promise<number | null>((res) => proc.once("exit", (code) => res(code)));
  return { name, proc, exited };
}

export async function stopAll(children: Child[], graceMs = 10_000): Promise<void> {
  for (const c of children) if (c.proc.exitCode === null) c.proc.kill("SIGTERM");
  await Promise.all(
    children.map((c) =>
      Promise.race([c.exited, new Promise<void>((r) => setTimeout(r, graceMs).unref())]).then(() => {
        if (c.proc.exitCode === null) c.proc.kill("SIGKILL");
      }),
    ),
  );
}

export const ENTRIES = {
  mocks: "packages/external/src/main.ts",
  sim: "apps/sim/src/main.ts",
  service: "apps/cli/src/service-entry.ts",
};
