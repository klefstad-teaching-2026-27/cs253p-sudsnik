import { err, ok, sudsnikError, type Result } from "@sudsnik/kernel";

/** A row another tenant owns, or none at all, is the same 404: the caller learns nothing about other operators. */
export function owned<T>(row: T | undefined, ownerId: string | undefined, tenantId: string, what: string): Result<T> {
  if (row === undefined || ownerId !== tenantId) return err(sudsnikError("NOT_FOUND", `no such ${what}`));
  return ok(row);
}
