// Lightweight Result type — the React/TS analogue of fpdart's Either<Failure, T>.
// Repositories return Result instead of throwing, so call sites handle control
// flow explicitly (mirrors the "No Direct Exceptions in Domain" rule).

export interface Failure {
  message: string;
  cause?: unknown;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: Failure };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const fail = <T = never>(message: string, cause?: unknown): Result<T> => ({
  ok: false,
  error: { message, cause },
});

/** Wraps an async operation, converting thrown errors into a Failure. */
export async function attempt<T>(
  fn: () => Promise<T>,
  context: string,
): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    const message =
      e instanceof Error ? `${context}: ${e.message}` : `${context}`;
    return fail(message, e);
  }
}
