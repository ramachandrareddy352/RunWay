// Logs hold only offer IDs, handles, counts and error codes (design §8.4 step 8). Every field is
// checked against an allowlist of keys and a short, plain value shape; anything else is replaced, so
// a key, a statement line or a signature can't reach a log by accident (test E7).

export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
}

export const ALLOWED_KEYS = new Set([
  "handle",
  "offer_id",
  "decision",
  "reason",
  "code",
  "source",
  "count",
  "buckets",
  "ms",
  "network",
  "agent",
  "height",
  "model",
  "status",
  "payout_id",
  "collect_id",
  "kind",
  "provider",
]);

const SAFE_VALUE = /^[A-Za-z0-9_.:@/-]{0,64}$/;

export function sanitizeFields(fields: LogFields = {}): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (!ALLOWED_KEYS.has(k)) {
      out[k] = "[redacted-key]";
      continue;
    }
    if (typeof v === "string" && !SAFE_VALUE.test(v)) out[k] = "[redacted]";
    else out[k] = v;
  }
  return out;
}

export function safeLogger(sink: (line: string) => void = (l) => console.log(l)): Logger {
  const write = (level: string, event: string, fields?: LogFields) => {
    const e = SAFE_VALUE.test(event) ? event : "[redacted-event]";
    sink(JSON.stringify({ level, event: e, ...sanitizeFields(fields) }));
  };
  return {
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
  };
}

/** Short error code for logs: the `ERR_*` constant if present, else the error class name. */
export function errorCode(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = /ERR_[A-Z_]+/.exec(msg);
  if (m) return m[0];
  return e instanceof Error ? e.name : "error";
}
