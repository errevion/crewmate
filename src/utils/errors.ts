/**
 * Standardized error response structure for all crewmate operations
 */
export interface ErrorResult {
  ok: false;
  error: string;
  details?: unknown;
}

/**
 * Standardized success response structure for all crewmate operations
 */
export interface SuccessResult<T> {
  ok: true;
  data: T;
}

/**
 * Discriminated union of success and error results
 */
export type Result<T> = SuccessResult<T> | ErrorResult;

/**
 * Base class for crewmate-specific errors
 */
export class CrewmateError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  /** @param message Error description */
  constructor(message: string, code: string = 'UNKNOWN_ERROR', details?: unknown) {
    super(message);
    this.name = 'CrewmateError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Creates a standardized error result
 */
export function failure(error: string, details?: unknown): ErrorResult {
  return {
    ok: false,
    error,
    ...(details !== undefined && { details }),
  };
}

/**
 * Creates a standardized success result
 */
export function success<T>(data: T): SuccessResult<T> {
  return {
    ok: true,
    data,
  };
}

/**
 * Helper to exit process with standardized error
 */
export function failAndExit(error: string, details?: unknown): never {
  const err = failure(error, details);
  // Write error to stdout so it can be parsed by callers
  process.stdout.write(JSON.stringify(err) + '\n');
  process.exit(1);
}

/**
 * Type guard to check if result is successful
 */
export function isSuccess<T>(result: Result<T>): result is SuccessResult<T> {
  return result.ok === true;
}
