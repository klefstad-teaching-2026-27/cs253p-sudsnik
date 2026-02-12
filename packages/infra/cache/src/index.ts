import type { Meter } from "@sudsnik/contracts";
import type { Clock } from "@sudsnik/kernel";

export interface CacheOptions {
  max: number;
  ttlMs: number;
  clock: Clock;
  meter: Meter;
  service: string;
}

export interface Cache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V, ttlMs?: number): void;
  delete(key: string): void;
  has(key: string): boolean;
  size(): number;
  stats(): { hits: number; misses: number; evictions: number };
}

/** In-process LRU with TTL on the simulated clock. Every get is a CACHE_READ, every set a CACHE_WRITE. */
export function createCache<V>(opts: CacheOptions): Cache<V> {
  if (opts.max < 1) throw new RangeError("cache max must be >= 1");
  const map = new Map<string, { value: V; expiresAt: number }>();
  const stats = { hits: 0, misses: 0, evictions: 0 };
  const tags = { service: opts.service };
  return {
    get(key) {
      opts.meter.charge("CACHE_READ", 1, tags);
      const hit = map.get(key);
      if (!hit) {
        stats.misses++;
        return undefined;
      }
      if (hit.expiresAt <= opts.clock.now()) {
        map.delete(key);
        stats.misses++;
        return undefined;
      }
      map.delete(key);
      map.set(key, hit);
      stats.hits++;
      return hit.value;
    },
    set(key, value, ttlMs = opts.ttlMs) {
      opts.meter.charge("CACHE_WRITE", 1, tags);
      if (map.has(key)) map.delete(key);
      // Least recently used: `get` re-inserts on a hit, so the front of the map is the coldest entry.
      else if (map.size >= opts.max) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) {
          map.delete(oldest);
          stats.evictions++;
        }
      }
      map.set(key, { value, expiresAt: opts.clock.now() + ttlMs });
    },
    delete: (key) => void map.delete(key),
    has(key) {
      const hit = map.get(key);
      return !!hit && hit.expiresAt > opts.clock.now();
    },
    size: () => map.size,
    stats: () => ({ ...stats }),
  };
}
