// FX sources for MultiSourceOracle (BUILD_PLAN T4b.3, SPIKES SP13, checked live 2026-11-11).
// Indian exchanges, because that is where rupees and USDC actually trade: CoinDCX USDC/INR, WazirX
// USDC/INR and Giottus USDT/INR (its USDC/INR book is too thin). Global references (CoinGecko
// usd-coin/inr ≈ ₹93.6, open.er-api USD/INR ≈ ₹94.0, daily) sat 6–7% below the Indian exchanges
// (≈ ₹99.5–101), so mixing them would always fail the 150 bps agreement rule.
// The URLs are hardcoded on purpose: each TEE image bundles this file, so the sources are measured.
import { inrPriceToPpu, type RateSource, type SourceReading } from "./index.js";

type Fetch = typeof fetch;

async function getJson(f: Fetch, url: string, signal: AbortSignal): Promise<unknown> {
  const res = await f(url, { signal, headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const str = (v: unknown, what: string): string => {
  if (typeof v !== "string" && typeof v !== "number") throw new Error(`missing ${what}`);
  return String(v);
};
const num = (v: unknown, what: string): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`missing ${what}`);
  return n;
};

export const COINDCX_TICKER = "https://api.coindcx.com/exchange/ticker";
export const WAZIRX_USDC = "https://api.wazirx.com/sapi/v1/ticker/24hr?symbol=usdcinr";
export const GIOTTUS_TICKER = "https://www.giottus.com/api/v2/ticker";

/** CoinDCX: array of tickers; `USDCINR.last_price`, `timestamp` in seconds. */
export function coinDcxSource(f: Fetch = fetch): RateSource {
  return {
    name: "coindcx:USDCINR",
    async read(signal): Promise<SourceReading> {
      const rows = (await getJson(f, COINDCX_TICKER, signal)) as { market?: string }[];
      const t = Array.isArray(rows)
        ? (rows.find((r) => r.market === "USDCINR") as Record<string, unknown>)
        : undefined;
      if (!t) throw new Error("USDCINR not listed");
      return {
        name: this.name,
        ratePpu: inrPriceToPpu(str(t.last_price, "last_price")),
        at: num(t.timestamp, "timestamp") * 1000,
      };
    },
  };
}

/** WazirX: `lastPrice`, `at` in milliseconds. */
export function wazirxSource(f: Fetch = fetch): RateSource {
  return {
    name: "wazirx:usdcinr",
    async read(signal): Promise<SourceReading> {
      const t = (await getJson(f, WAZIRX_USDC, signal)) as Record<string, unknown>;
      return { name: this.name, ratePpu: inrPriceToPpu(str(t.lastPrice, "lastPrice")), at: num(t.at, "at") };
    },
  };
}

/** Giottus: object of tickers; `usdtinr.last`, `at` in seconds. */
export function giottusSource(f: Fetch = fetch): RateSource {
  return {
    name: "giottus:usdtinr",
    async read(signal): Promise<SourceReading> {
      const all = (await getJson(f, GIOTTUS_TICKER, signal)) as Record<string, Record<string, unknown>>;
      const t = all?.usdtinr;
      if (!t) throw new Error("usdtinr not listed");
      return { name: this.name, ratePpu: inrPriceToPpu(str(t.last, "last")), at: num(t.at, "at") * 1000 };
    },
  };
}

export const indianExchangeSources = (f: Fetch = fetch): RateSource[] => [
  coinDcxSource(f),
  wazirxSource(f),
  giottusSource(f),
];
