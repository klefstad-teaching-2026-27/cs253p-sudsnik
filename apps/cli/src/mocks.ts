import { ENTRIES, repoRoot, spawnTs } from "./children.js";
import { withDefaults } from "./env.js";

/** `apps/cli mocks`: the seven mocks in one child process with laptop defaults. */
export async function startAllMocksProcess(): Promise<void> {
  const env = withDefaults(process.env, { single: false });
  const child = spawnTs("mocks", `${repoRoot()}/${ENTRIES.mocks}`, env);
  const stop = () => child.proc.kill("SIGTERM");
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  await child.exited;
}
