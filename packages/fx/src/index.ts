// INR <-> USDC conversion and the FX oracle (BUILD_PLAN T4b.3, design §9A.4).
// Units: INR in paise, rates in paise per 1 USDC ("ppu"), USDC in micro-units. Floor rounding
// everywhere; results are identical to `runway_shared::fx` (vectors SC5).

const BPS = 10_000n;
const MICRO = 1_000_000n;

function checkRate(ratePpu: number): bigint {
  if (!Number.isSafeInteger(ratePpu) || ratePpu <= 0) throw new RangeError(`bad rate ${ratePpu}`);
  return BigInt(ratePpu);
}

function checkSpread(spreadBps: number): bigint {
  if (!Number.isSafeInteger(spreadBps) || spreadBps < 0 || spreadBps >= 10_000) {
    throw new RangeError(`bad spread ${spreadBps}`);
  }
  return BigInt(spreadBps);
}

function checkAmount(v: bigint): bigint {
  if (v < 0n) throw new RangeError("negative amount");
  return v;
}

/** `floor(paise × 1e6 × (10_000 − spread) / (rate × 10_000))` */
export function inrToUsdc(paise: bigint, ratePpu: number, spreadBps: number): bigint {
  return (checkAmount(paise) * MICRO * (BPS - checkSpread(spreadBps))) / (checkRate(ratePpu) * BPS);
}

/** `floor(usdc × rate × (10_000 − spread) / (1e6 × 10_000))` */
export function usdcToInr(usdc: bigint, ratePpu: number, spreadBps: number): bigint {
  return (checkAmount(usdc) * checkRate(ratePpu) * (BPS - checkSpread(spreadBps))) / (MICRO * BPS);
}

/** "₹10,086.91" (Indian digit grouping). */
export function formatInr(paise: bigint): string {
  const neg = paise < 0n;
  const abs = neg ? -paise : paise;
  const rupees = (abs / 100n).toString();
  const p = (abs % 100n).toString().padStart(2, "0");
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}₹${rest ? `${rest},${last3}` : last3}.${p}`;
}

// ---------- oracle ----------

export interface SourceReading {
  name: string;
  /** Paise per USDC, integer. */
  ratePpu: number;
  /** Source timestamp, ms since epoch. */
  at: number;
}

export interface RateSource {
  name: string;
  read(signal: AbortSignal): Promise<SourceReading>;
}

export interface OracleReading {
  paused: boolean;
  /** Median of the agreeing sources (0 when paused). */
  ratePpu: number;
  at: number;
  used: SourceReading[];
  dropped: { name: string; reason: string }[];
  reason?: string;
}

export interface Oracle {
  read(): Promise<OracleReading>;
}

/** Sandbox oracle: one fixed rate (₹85.00 = 8_500 ppu in the sandbox profile). */
export class FixedOracle implements Oracle {
  constructor(
    private readonly ratePpu: number,
    private readonly now: () => number = Date.now,
  ) {
    checkRate(ratePpu);
  }
  async read(): Promise<OracleReading> {
    const at = this.now();
    const used = [{ name: "fixed", ratePpu: this.ratePpu, at }];
    return { paused: false, ratePpu: this.ratePpu, at, used, dropped: [] };
  }
}

export interface MultiSourceOptions {
  timeoutMs?: number;
  maxAgeMs?: number;
  maxDeviationBps?: number;
  minSources?: number;
  cacheMs?: number;
  now?: () => number;
}

/** Integer median; for an even count, the floor of the mean of the two middle values. */
export function medianInt(values: number[]): number {
  if (values.length === 0) throw new RangeError("empty");
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.floor((s[m - 1]! + s[m]!) / 2);
}

/**
 * Reads every source in parallel (3 s timeout), drops stale (> 60 s) and invalid readings, takes
 * the median, keeps sources within 150 bps of it, and pauses unless at least 2 remain. The result
 * is cached for 15 s. Fails closed: any doubt → `paused: true`.
 */
export class MultiSourceOracle implements Oracle {
  private cache: { until: number; reading: OracleReading } | undefined;
  private readonly o: Required<MultiSourceOptions>;

  constructor(
    private readonly sources: RateSource[],
    opts: MultiSourceOptions = {},
  ) {
    this.o = {
      timeoutMs: opts.timeoutMs ?? 3_000,
      maxAgeMs: opts.maxAgeMs ?? 60_000,
      maxDeviationBps: opts.maxDeviationBps ?? 150,
      minSources: opts.minSources ?? 2,
      cacheMs: opts.cacheMs ?? 15_000,
      now: opts.now ?? Date.now,
    };
  }

  async read(): Promise<OracleReading> {
    const now = this.o.now();
    if (this.cache && now < this.cache.until) return this.cache.reading;
    const dropped: { name: string; reason: string }[] = [];
    const fresh: SourceReading[] = [];

    const results = await Promise.allSettled(
      this.sources.map(async (s) => {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs);
        try {
          return await Promise.race([
            s.read(ctl.signal),
            new Promise<never>((_, rej) =>
              ctl.signal.addEventListener("abort", () => rej(new Error("timeout"))),
            ),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }),
    );
    results.forEach((r, i) => {
      const name = this.sources[i]!.name;
      if (r.status === "rejected") {
        dropped.push({ name, reason: `error: ${(r.reason as Error)?.message ?? r.reason}` });
        return;
      }
      const v = r.value;
      if (!Number.isSafeInteger(v.ratePpu) || v.ratePpu <= 0) dropped.push({ name, reason: "invalid rate" });
      else if (now - v.at > this.o.maxAgeMs) dropped.push({ name, reason: "stale" });
      else fresh.push(v);
    });

    let reading: OracleReading;
    if (fresh.length < this.o.minSources) {
      reading = paused(now, fresh, dropped, `only ${fresh.length} fresh source(s)`);
    } else {
      const mid = medianInt(fresh.map((r) => r.ratePpu));
      const used: SourceReading[] = [];
      for (const r of fresh) {
        const devBps = (Math.abs(r.ratePpu - mid) * 10_000) / mid;
        if (devBps <= this.o.maxDeviationBps) used.push(r);
        else dropped.push({ name: r.name, reason: `diverges ${devBps.toFixed(0)} bps from the median` });
      }
      reading =
        used.length < this.o.minSources
          ? paused(now, used, dropped, `only ${used.length} source(s) agree`)
          : { paused: false, ratePpu: medianInt(used.map((r) => r.ratePpu)), at: now, used, dropped };
    }
    this.cache = { until: now + this.o.cacheMs, reading };
    return reading;
  }
}

function paused(
  at: number,
  used: SourceReading[],
  dropped: { name: string; reason: string }[],
  reason: string,
): OracleReading {
  return { paused: true, ratePpu: 0, at, used, dropped, reason };
}

/** Converts a decimal INR-per-USD(C) price ("85.1234") to integer paise per USDC (floor). */
export function inrPriceToPpu(price: string | number): number {
  const s = typeof price === "number" ? price.toFixed(6) : price.trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new RangeError(`bad price ${s}`);
  const paise = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0").slice(0, 2));
  if (!Number.isSafeInteger(paise) || paise <= 0) throw new RangeError(`bad price ${s}`);
  return paise;
}
