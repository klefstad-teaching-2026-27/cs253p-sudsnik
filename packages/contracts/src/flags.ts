export const FLAG_NAMES = [
  "orders.enabled",
  "dispatch.enabled",
  "washnodes.enabled",
  "billing.enabled",
  "tracking.enabled",
  "accounts.enabled",
  "notify.enabled",
  "support.enabled",
  "api.v2",
] as const;
export type FlagName = (typeof FLAG_NAMES)[number];

export interface Flags {
  isOn(name: FlagName): boolean;
}

export function isFlagName(s: string): s is FlagName {
  return (FLAG_NAMES as readonly string[]).includes(s);
}

/** Parses SUDSNIK_FLAGS: comma-separated names that are on; unknown names are rejected. */
export function parseFlags(value: string | undefined): Flags {
  const on = new Set<FlagName>();
  for (const raw of (value ?? "").split(",")) {
    const name = raw.trim();
    if (name === "") continue;
    if (!isFlagName(name)) throw new RangeError(`unknown flag ${name}`);
    on.add(name);
  }
  return { isOn: (name) => on.has(name) };
}

export const DEFAULT_FLAGS = FLAG_NAMES.filter((f) => f.endsWith(".enabled") && !["billing.enabled"].includes(f)).join(",");
