import { createHash } from "node:crypto";

const SEED_RE = /^[0-9a-f]{16}$/;

export function isSeed(s: string): boolean {
  return SEED_RE.test(s);
}

/** Sub-seed for a component: first 16 hex characters of SHA-256(`seed:componentName`). */
export function subSeed(seed: string, componentName: string): string {
  return createHash("sha256").update(`${seed}:${componentName}`).digest("hex").slice(0, 16);
}

/** Deterministic PRNG (SplitMix64 over the seed) yielding floats in [0, 1). */
export class Rng {
  private state: bigint;

  constructor(seed: string) {
    if (!isSeed(seed)) throw new RangeError(`seed must be 16 hex characters, got ${seed}`);
    this.state = BigInt(`0x${seed}`);
  }

  nextU64(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
    return z ^ (z >> 31n);
  }

  float(): number {
    return Number(this.nextU64() >> 11n) / 2 ** 53;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.float() * maxExclusive);
  }

  chance(rate: number): boolean {
    return this.float() < rate;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("pick from empty list");
    return items[this.int(items.length)]!;
  }
}
