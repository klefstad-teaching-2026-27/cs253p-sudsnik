import { posix } from "node:path";

export function toPosix(file: string): string {
  return file.replace(/\\/g, "/");
}

/** True when `file` has `dir` (a slash-separated path such as `packages/infra`) as a directory somewhere in it. */
export function inAnyDir(file: string, dirs: readonly string[]): boolean {
  const f = toPosix(file);
  return dirs.some((dir) => f.includes(`/${dir.replace(/^\/|\/$/g, "")}/`));
}

export function inSrc(file: string): boolean {
  return toPosix(file).includes("/src/");
}

export function inTest(file: string): boolean {
  return toPosix(file).includes("/test/");
}

/** The package directory of `file`: whatever precedes its last `/src/`, `/test/`, or `/testing/` segment. */
export function packageDir(file: string): string {
  const f = toPosix(file);
  const m = f.match(/^(.*)\/(?:src|test|testing)\/[^/]*(?:\/|$)/);
  return m?.[1] ?? posix.dirname(f);
}

/** For a file under `src/variants/<name>/`, that directory; otherwise undefined. */
export function ownVariantDir(file: string): string | undefined {
  const m = toPosix(file).match(/^(.*\/src\/variants\/[^/]+)\//);
  return m?.[1];
}

/** The one file that may name a variant from outside `variants/`: the package's `src/index.ts` (system-spec §8). */
export function isSelector(file: string): boolean {
  return /\/src\/index\.ts$/.test(toPosix(file));
}

export function resolveRelative(file: string, source: string): string {
  return posix.resolve(posix.dirname(toPosix(file)), source);
}
