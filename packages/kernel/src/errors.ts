export const ERROR_CODES = {
  INVALID: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  QUOTA: 429,
  INTERNAL: 500,
  UNAVAILABLE: 503,
  TIMEOUT: 504,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface SudsnikError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  cause?: unknown;
}

const RETRYABLE: ReadonlySet<ErrorCode> = new Set(["QUOTA", "UNAVAILABLE", "TIMEOUT"]);

export function sudsnikError(code: ErrorCode, message: string, cause?: unknown): SudsnikError {
  return { code, message, retryable: RETRYABLE.has(code), ...(cause === undefined ? {} : { cause }) };
}

export function httpStatus(code: ErrorCode): number {
  return ERROR_CODES[code];
}

export function isSudsnikError(x: unknown): x is SudsnikError {
  return typeof x === "object" && x !== null && "code" in x && "retryable" in x && (x as SudsnikError).code in ERROR_CODES;
}
