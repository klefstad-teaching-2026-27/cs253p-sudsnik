import { monotonicFactory } from "ulidx";

/**
 * Monotonic within the process, which the plain factory is not: two ULIDs minted in the same millisecond get
 * independent random suffixes and can sort against the order they were created in. Ids are read back in id order
 * and paginated with a keyset over that order (`orders` `OrderRepository.list`), so an id that sorts backwards
 * drops or repeats a row at a page boundary.
 */
const nextId = monotonicFactory();

export function newId(): string {
  return nextId();
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(s: string): boolean {
  return ULID_RE.test(s);
}
