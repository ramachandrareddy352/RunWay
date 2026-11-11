// NEAR Intents 1Click client and quote verification (BUILD_PLAN T2.1).
//
// 1Click settles on mainnet only and refuses `.testnet` recipients (SPIKES SP16). Under Amendment A1
// the testnet pay page uses `dry: true` quotes as a live *price preview* to an existing mainnet
// account, and the payment itself is simulated on testnet. `verifyQuote` implements every check
// for real (non-dry) quotes too; in dry mode the deadline and deposit-address checks are reported as
// skipped, never as passed.
import {
  GetExecutionStatusResponse,
  QuoteRequest,
  verifyQuoteSignature,
  type QuoteResponse,
  type TokenResponse,
} from "@defuse-protocol/one-click-sdk-typescript";

export const ONECLICK_BASE = "https://1click.chaindefuser.com";
/** USDC on NEAR (mainnet), the only destination asset Runway accepts. */
export const USDC_NEAR_ASSET = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
/** Existing mainnet account used as the recipient of testnet price previews (dry quotes only). */
export const PREVIEW_RECIPIENT = "intents.near";

export type Token = TokenResponse;
export type Quote = QuoteResponse;
export type Status = GetExecutionStatusResponse;
export type StatusName = `${GetExecutionStatusResponse.status}`;
export const STATUSES: readonly StatusName[] = [
  "PENDING_DEPOSIT",
  "KNOWN_DEPOSIT_TX",
  "INCOMPLETE_DEPOSIT",
  "PROCESSING",
  "SUCCESS",
  "REFUNDED",
  "FAILED",
];
export const TERMINAL_STATUSES: readonly StatusName[] = ["SUCCESS", "REFUNDED", "FAILED"];

export interface OneClickOptions {
  base?: string;
  /** Partner JWT. Server-side only; never send it from a browser. */
  apiKey?: string;
  fetch?: typeof fetch;
}

export class OneClickError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit, opts: OneClickOptions = {}): Promise<T> {
  const f = opts.fetch ?? fetch;
  const headers: Record<string, string> = { accept: "application/json" };
  if (init.body) headers["content-type"] = "application/json";
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
  const res = await f(`${opts.base ?? ONECLICK_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg = (body as { message?: string } | undefined)?.message ?? res.statusText;
    throw new OneClickError(`1Click ${path}: ${res.status} ${msg}`, res.status, body);
  }
  return body as T;
}

let tokenCache: { at: number; tokens: Token[] } | undefined;
const TOKEN_TTL_MS = 5 * 60_000;

/** Supported tokens, cached for 5 minutes. */
export async function getTokens(opts: OneClickOptions = {}): Promise<Token[]> {
  if (tokenCache && Date.now() - tokenCache.at < TOKEN_TTL_MS) return tokenCache.tokens;
  const tokens = await request<Token[]>("/v0/tokens", { method: "GET" }, opts);
  tokenCache = { at: Date.now(), tokens };
  return tokens;
}

export interface QuoteInput {
  dry: boolean;
  originAsset: string;
  /** Exact USDC out, in micro-USDC. */
  amountOut: bigint;
  recipient: string;
  refundTo: string;
  slippageBps?: number;
  /** Deposit address lifetime. */
  ttlMs?: number;
}

/** Builds the canonical Runway quote request: EXACT_OUTPUT to USDC on NEAR, no app fees. */
export function quoteRequest(i: QuoteInput, now = new Date()): QuoteRequest {
  return {
    dry: i.dry,
    swapType: QuoteRequest.swapType.EXACT_OUTPUT,
    slippageTolerance: i.slippageBps ?? 100,
    originAsset: i.originAsset,
    depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
    destinationAsset: USDC_NEAR_ASSET,
    amount: i.amountOut.toString(),
    refundTo: i.refundTo,
    refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
    recipient: i.recipient,
    recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN,
    deadline: new Date(now.getTime() + (i.ttlMs ?? 15 * 60_000)).toISOString(),
    referral: "runway",
  };
}

export async function getQuote(req: QuoteRequest, opts: OneClickOptions = {}): Promise<Quote> {
  return request<Quote>("/v0/quote", { method: "POST", body: JSON.stringify(req) }, opts);
}

export async function getStatus(
  depositAddress: string,
  depositMemo?: string,
  opts: OneClickOptions = {},
): Promise<Status> {
  const q = new URLSearchParams({ depositAddress });
  if (depositMemo) q.set("depositMemo", depositMemo);
  return request<Status>(`/v0/status?${q}`, { method: "GET" }, opts);
}

// ---------- verification ----------

export interface Expected {
  /** The settlement account (or PREVIEW_RECIPIENT for a testnet price preview). */
  settlement: string;
  usdcAssetId: string;
  /** Minimum acceptable USDC out, micro-USDC. */
  minOut: bigint;
  now: Date;
  /** A dry quote has no deadline or deposit address; those checks are reported as skipped. */
  dry: boolean;
}

export type CheckId =
  | "signature"
  | "dry"
  | "recipient"
  | "destinationAsset"
  | "minAmountOut"
  | "deadline"
  | "depositAddress"
  | "status";

export interface Check {
  id: CheckId;
  ok: boolean;
  skipped: boolean;
  detail: string;
}

export interface VerifyReport {
  /** True only if every non-skipped check passed. */
  ok: boolean;
  checks: Check[];
}

const pass = (id: CheckId, detail: string): Check => ({ id, ok: true, skipped: false, detail });
const fail = (id: CheckId, detail: string): Check => ({ id, ok: false, skipped: false, detail });
const skip = (id: CheckId, detail: string): Check => ({ id, ok: true, skipped: true, detail });

function toBig(v: unknown): bigint | undefined {
  try {
    return typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : undefined;
  } catch {
    return undefined;
  }
}

/** Every check from BUILD_PLAN T2.1. Never throws. */
export function verifyQuote(q: unknown, e: Expected): VerifyReport {
  const checks: Check[] = [];
  const r = q as Partial<Quote> | undefined;
  const req = r?.quoteRequest;
  const quote = r?.quote;
  if (!r || !req || !quote) {
    return { ok: false, checks: [fail("signature", "malformed quote response")] };
  }

  let sigOk = false;
  try {
    sigOk = verifyQuoteSignature(r as Quote);
  } catch {
    sigOk = false;
  }
  checks.push(
    sigOk ? pass("signature", "signed by the 1Click manager key") : fail("signature", "bad signature"),
  );

  checks.push(
    req.dry === e.dry
      ? pass("dry", e.dry ? "dry quote (price preview)" : "live quote")
      : fail("dry", `expected dry=${e.dry}, got ${String(req.dry)}`),
  );

  checks.push(
    req.recipient === e.settlement && req.recipientType === QuoteRequest.recipientType.DESTINATION_CHAIN
      ? pass("recipient", `${req.recipient} (DESTINATION_CHAIN)`)
      : fail(
          "recipient",
          `expected ${e.settlement}, got ${String(req.recipient)} (${String(req.recipientType)})`,
        ),
  );

  checks.push(
    req.destinationAsset === e.usdcAssetId
      ? pass("destinationAsset", "USDC on NEAR")
      : fail("destinationAsset", `unexpected asset ${String(req.destinationAsset)}`),
  );

  const minOut = toBig(quote.minAmountOut);
  checks.push(
    minOut !== undefined && minOut >= e.minOut
      ? pass("minAmountOut", `${minOut} ≥ ${e.minOut}`)
      : fail("minAmountOut", `minAmountOut ${String(quote.minAmountOut)} < ${e.minOut}`),
  );

  if (e.dry) {
    checks.push(skip("deadline", "dry quotes have no deadline"));
    // The signature of a dry quote does not cover a deposit address (test SD5), so one appearing
    // here was injected and must never be shown to a payer.
    checks.push(
      quote.depositAddress
        ? fail("depositAddress", "a dry quote carries a deposit address (not covered by the signature)")
        : skip("depositAddress", "dry quotes have no deposit address"),
    );
  } else {
    const deadline = quote.deadline ? Date.parse(quote.deadline) : NaN;
    checks.push(
      Number.isFinite(deadline) && deadline > e.now.getTime()
        ? pass("deadline", quote.deadline!)
        : fail("deadline", `deadline ${String(quote.deadline)} is missing or past`),
    );
    checks.push(
      quote.depositAddress
        ? pass("depositAddress", quote.depositAddress)
        : fail("depositAddress", "no deposit address"),
    );
  }

  return { ok: checks.every((c) => c.ok), checks };
}

/**
 * Re-reads `/v0/status` for a live deposit address: the stored quote must verify again, point at
 * the same deposit address, and the swap must not have started yet.
 */
export async function verifyDeposit(
  depositAddress: string,
  e: Expected,
  opts: OneClickOptions & { depositMemo?: string } = {},
): Promise<VerifyReport> {
  let status: Status;
  try {
    status = await getStatus(depositAddress, opts.depositMemo, opts);
  } catch (err) {
    return { ok: false, checks: [fail("status", `status unavailable: ${(err as Error).message}`)] };
  }
  const report = verifyQuote(status.quoteResponse, { ...e, dry: false });
  const sameAddress = status.quoteResponse?.quote?.depositAddress === depositAddress;
  const S = GetExecutionStatusResponse.status;
  const pending = status.status === S.PENDING_DEPOSIT || status.status === S.KNOWN_DEPOSIT_TX;
  report.checks.push(
    sameAddress && pending
      ? pass("status", `${status.status} for ${depositAddress}`)
      : fail(
          "status",
          sameAddress ? `status is ${status.status}` : "status quote has a different deposit address",
        ),
  );
  return { ok: report.checks.every((c) => c.ok), checks: report.checks };
}

/** Chain minimums in micro-USD from the 1Click swap-limit docs (BUILD_PLAN T2.1; re-check the docs). */
const CHAIN_MINIMUM_UUSD: Record<string, bigint> = {
  bsc: 1_000_000_000n,
  tron: 100_000_000n,
};

export function minimumFor(chain: string): bigint {
  return CHAIN_MINIMUM_UUSD[chain] ?? 0n;
}
