// Startup steps that need the chain (checking the agent's registration, publishing its first session
// key) are retried with backoff instead of crashing the service on one failed RPC request.

export async function retry<T>(
  step: () => Promise<T>,
  o: {
    attempts?: number;
    firstDelayMs?: number;
    maxDelayMs?: number;
    onRetry?: (err: unknown, attempt: number) => void;
  } = {},
): Promise<T> {
  const attempts = o.attempts ?? 8;
  let delay = o.firstDelayMs ?? 2_000;
  for (let attempt = 1; ; attempt++) {
    try {
      return await step();
    } catch (err) {
      if (attempt >= attempts) throw err;
      o.onRetry?.(err, attempt);
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, o.maxDelayMs ?? 30_000);
    }
  }
}
