import { fetch } from "undici";

export async function waitForReady(url: string, deadlineMs: number, pollMs = 100): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const r = await fetch(url);
      if (r.status === 200) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return false;
}
