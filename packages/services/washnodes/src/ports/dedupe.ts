/** Ids already acted on: envelope ids for handlers, callback ids for the washer callback route. */
export interface Dedupe {
  seen(id: string): boolean;
  mark(id: string, nowMs: number): void;
}
