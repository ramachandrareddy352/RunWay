export const MICRO = 1_000_000n;

/** "1,234.56" from micro-USDC (floor to cents for display). */
export function fmtUsdc(micro: bigint | string | number, digits = 2): string {
  const v = BigInt(micro);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = (abs / MICRO).toLocaleString("en-US");
  const frac = (abs % MICRO).toString().padStart(6, "0").slice(0, digits);
  return `${neg ? "-" : ""}${whole}${digits > 0 ? `.${frac}` : ""}`;
}

/** "12.5" → 12_500_000n; null for anything that isn't a positive amount with ≤ 6 decimals. */
export function parseUsdc(text: string): bigint | null {
  const m = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(text.trim());
  if (!m) return null;
  return BigInt(m[1]!) * MICRO + BigInt((m[2] ?? "").padEnd(6, "0"));
}

/** "8500" or "8,500.50" rupees → paise. */
export function parseRupees(text: string): bigint | null {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text.replace(/,/g, "").trim());
  if (!m) return null;
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
}

export const bps = (b: number) => `${(b / 100).toFixed(2)}%`;
export const short = (s: string, n = 6) => (s.length > 2 * n + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);
