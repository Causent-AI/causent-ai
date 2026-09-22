export class DecisionReportGenerationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Decision Report generation timed out after ${timeoutMs}ms.`);
    this.name = "DecisionReportGenerationTimeoutError";
  }
}

export async function runWithSingleRetry<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  shouldRetry: (error: unknown) => boolean = () => true,
  signal?: AbortSignal,
): Promise<{ value: T; attempts: number }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    let rejectAbort: (reason: unknown) => void = () => {};
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const onAbort = () => { controller.abort(signal?.reason); rejectAbort(signal?.reason); };
    signal?.addEventListener("abort", onAbort, { once: true });
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new DecisionReportGenerationTimeoutError(timeoutMs));
      }, timeoutMs);
    });

    try {
      const value = await Promise.race([operation(controller.signal), timeout, aborted]);
      return { value, attempts: attempt };
    } catch (error) {
      lastError = error;
      signal?.throwIfAborted();
      if (!shouldRetry(error)) throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  throw lastError;
}
