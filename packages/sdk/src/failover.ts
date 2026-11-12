// Several RPCs behind one client. Free public RPCs rate-limit by IP, and cloud hosts share IPs, so a
// single RPC answering HTTP 429 must not stop a service.

/** True when the RPC itself is unavailable (rate limit, server error, timeout, network failure),
 * as opposed to the chain answering with an error that every RPC would return. */
export function rpcUnavailable(e: unknown): boolean {
  const err = e as { cause?: unknown; status?: unknown; type?: unknown; name?: unknown; message?: unknown };
  for (const code of [err.status, err.cause]) {
    if (typeof code === "number" && (code === 429 || code === 408 || code >= 500)) return true;
  }
  if (err.type === "RetriesExceeded" || err.name === "AbortError" || err.name === "TimeoutError") return true;
  const nested = (err.cause as { code?: unknown } | undefined)?.code;
  if (typeof nested === "string" && /^(ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR)/.test(nested))
    return true;
  return /fetch failed|failed to fetch|network ?error|rate limit|too many requests/i.test(
    String(err.message ?? e),
  );
}

/**
 * One client over several with the same interface (for example near-api-js JsonRpcProviders, one per
 * RPC). A call moves to the next client only when the current one is unavailable (`rpcUnavailable`);
 * any other error reaches the caller unchanged, so near-api-js still sees InvalidNonce or Expired and
 * retries the transaction itself. The client that last answered is tried first.
 */
export function failover<T extends object>(clients: T[], unavailable = rpcUnavailable): T {
  if (clients.length === 0) throw new Error("failover needs at least one client");
  let current = 0;
  return new Proxy(clients[0]!, {
    get(_target, prop) {
      const value = (clients[current] as Record<PropertyKey, unknown>)[prop];
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        let last: unknown;
        for (let i = 0; i < clients.length; i++) {
          const idx = (current + i) % clients.length;
          const c = clients[idx] as Record<PropertyKey, (...a: unknown[]) => unknown>;
          try {
            const result = await c[prop]!.apply(c, args);
            current = idx;
            return result;
          } catch (e) {
            if (!unavailable(e)) throw e;
            last = e;
          }
        }
        throw last;
      };
    },
  });
}
