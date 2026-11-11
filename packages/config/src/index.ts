// Network profiles: the single source of truth for scripts, web, API and TEE (BUILD_PLAN §10.1).
// Money is micro-USDC (bigint, 6 decimals). Contract JSON uses decimal strings.

export type Network = "sandbox" | "testnet" | "mainnet";

export const USDC_DECIMALS = 6;
export const USDC = 1_000_000n;
/** USDC on NEAR (mainnet) — 1Click asset id is `nep141:` + this. */
export const MAINNET_USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const MAINNET_USDC_ASSET_ID = `nep141:${MAINNET_USDC}`;
export const ONECLICK_BASE_URL = "https://1click.chaindefuser.com";

export const usdc = (whole: number | bigint): bigint => BigInt(whole) * USDC;
export const yocto = (near: number): bigint => BigInt(Math.round(near * 1e6)) * 10n ** 18n;

/** Contract accounts under a deployment root (BUILD_PLAN §8.2), e.g. `runway-rama.testnet`. */
export interface Deployment {
  root: string;
  credit: string;
  /** The factory; settlements are `<handle>.<factory>`. */
  factory: string;
  /** Mock USDC on sandbox/testnet. */
  token: string;
  inr: string;
}

export function deploymentFor(root: string): Deployment {
  return {
    root,
    credit: `credit.${root}`,
    factory: `pay.${root}`,
    token: `musdc.${root}`,
    inr: `inr.${root}`,
  };
}

export const settlementAccount = (handle: string, factory: string): string => `${handle}.${factory}`;

/** Mirrors `Policy` in contracts/credit/src/types.rs. */
export interface Policy {
  version: number;
  anchoredCaps: bigint[];
  unanchoredCaps: bigint[];
  minLoan: bigint;
  feeBpsMin: number;
  feeBpsMax: number;
  repayBpsMin: number;
  repayBpsMax: number;
  maxUtilizationBps: number;
  maxExposurePerMerchant: bigint;
  dailyNewMerchantExposure: bigint;
  minPeriodRepayBps: number;
  defaultAfterMissed: number;
  delinquencyProvisionBps: number;
  protocolFeeShareBps: number;
  /** yoctoNEAR forwarded to the factory (settlement account balance + token storage). */
  merchantRegistrationDeposit: bigint;
}

export interface TimeParams {
  periodSec: number;
  withdrawCooldownSec: number;
  offerTtlSec: number;
  policyTimelockSec: number;
}

export interface Profile {
  network: Network;
  bucketSec: number;
  lockTimeoutBlocks: number;
  attestationExpirationMs: number;
  requiresTee: boolean;
  /** yoctoNEAR given to each new settlement account. */
  settlementBalance: bigint;
  /** yoctoNEAR for the token storage_deposit of a settlement account. */
  tokenStorage: bigint;
  policy: Policy;
  time: TimeParams;
  /** Where the underwriter reads routed revenue from. */
  revenueSource: "sandbox-buckets" | "testnet-buckets" | "1click-verified";
  rpcUrls: string[];
  /** INR gateway limits and float (BUILD_PLAN §10.1). */
  gateway: GatewayProfile;
}

/** Mirrors `GatewayLimits` in contracts/inr-gateway/src/types.rs, plus the initial float. */
export interface GatewayProfile {
  spreadBps: number;
  /** Paise per USDC. */
  minRatePpu: number;
  maxRatePpu: number;
  maxPayinPaise: bigint;
  dailyPayinPaise: bigint;
  maxPayoutUsdc: bigint;
  initialFloat: bigint;
}

const gatewayProfile = (spreadBps: number, initialFloat: bigint): GatewayProfile => ({
  spreadBps,
  minRatePpu: 7_000,
  maxRatePpu: 13_000,
  maxPayinPaise: 10_000_000n,
  dailyPayinPaise: 100_000_000n,
  maxPayoutUsdc: usdc(2_000),
  initialFloat,
});

/** The testnet deployment root (Amendment A1). */
export const TESTNET_ROOT = "runway-rama.testnet";

const SETTLEMENT_BALANCE = yocto(2);
const TOKEN_STORAGE = 1_250_000_000_000_000_000_000n; // 0.00125 NEAR

const basePolicy = (merchantRegistrationDeposit: bigint): Policy => ({
  version: 1,
  anchoredCaps: [usdc(500), usdc(2_000), usdc(5_000), usdc(15_000)],
  unanchoredCaps: [usdc(100), usdc(250), usdc(500), usdc(1_000)],
  minLoan: usdc(50),
  feeBpsMin: 300,
  feeBpsMax: 1500,
  repayBpsMin: 500,
  repayBpsMax: 2500,
  maxUtilizationBps: 8000,
  maxExposurePerMerchant: usdc(15_000),
  dailyNewMerchantExposure: usdc(2_000),
  minPeriodRepayBps: 1000,
  defaultAfterMissed: 2,
  delinquencyProvisionBps: 5000,
  protocolFeeShareBps: 1000,
  merchantRegistrationDeposit,
});

export const profiles: Record<Network, Profile> = {
  sandbox: {
    network: "sandbox",
    // Fast-forward makes long buckets cheap (~200 blocks in ~10 s wall), and one bucket must fit the
    // offer, the acceptance and a deliver + settle (~80 s of sandbox chain time) with headroom.
    bucketSec: 300,
    lockTimeoutBlocks: 20,
    attestationExpirationMs: 86_400_000,
    requiresTee: false,
    settlementBalance: SETTLEMENT_BALANCE,
    tokenStorage: TOKEN_STORAGE,
    policy: basePolicy(SETTLEMENT_BALANCE + TOKEN_STORAGE),
    // Periods are long so the scripted demo never crosses a period boundary; tests use their own.
    time: { periodSec: 3_600, withdrawCooldownSec: 5, offerTtlSec: 600, policyTimelockSec: 0 },
    revenueSource: "sandbox-buckets",
    rpcUrls: [],
    gateway: gatewayProfile(0, usdc(1_000)),
  },
  testnet: {
    network: "testnet",
    bucketSec: 300,
    lockTimeoutBlocks: 300,
    attestationExpirationMs: 604_800_000,
    requiresTee: false,
    settlementBalance: SETTLEMENT_BALANCE,
    tokenStorage: TOKEN_STORAGE,
    policy: basePolicy(SETTLEMENT_BALANCE + TOKEN_STORAGE),
    time: { periodSec: 300, withdrawCooldownSec: 120, offerTtlSec: 3_600, policyTimelockSec: 600 },
    revenueSource: "testnet-buckets",
    gateway: gatewayProfile(50, usdc(5_000)),
    // Two independent operators (BUILD_PLAN §8.1). Verify availability in T2.1 against
    // https://docs.near.org/api/rpc/providers and replace if either is retired or rate-limited.
    rpcUrls: ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"],
  },
  mainnet: {
    network: "mainnet",
    bucketSec: 2_592_000,
    lockTimeoutBlocks: 1_000,
    attestationExpirationMs: 604_800_000,
    requiresTee: true,
    settlementBalance: SETTLEMENT_BALANCE,
    tokenStorage: TOKEN_STORAGE,
    policy: {
      ...basePolicy(SETTLEMENT_BALANCE + TOKEN_STORAGE),
      anchoredCaps: [usdc(5), usdc(10), usdc(20), usdc(20)],
      unanchoredCaps: [usdc(1), usdc(2), usdc(5), usdc(5)],
      minLoan: usdc(1),
      maxExposurePerMerchant: usdc(20),
      dailyNewMerchantExposure: usdc(10),
    },
    time: {
      periodSec: 2_592_000,
      withdrawCooldownSec: 604_800,
      offerTtlSec: 259_200,
      policyTimelockSec: 172_800,
    },
    revenueSource: "1click-verified",
    gateway: {
      ...gatewayProfile(50, 0n),
      maxPayinPaise: 10_000n,
      dailyPayinPaise: 50_000n,
      maxPayoutUsdc: usdc(5),
    },
    rpcUrls: ["https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org"],
  },
};

/** Policy as the credit contract's JSON expects it. */
export function policyJson(p: Policy): Record<string, unknown> {
  return {
    version: p.version,
    anchored_caps: p.anchoredCaps.map(String),
    unanchored_caps: p.unanchoredCaps.map(String),
    min_loan: String(p.minLoan),
    fee_bps_min: p.feeBpsMin,
    fee_bps_max: p.feeBpsMax,
    repay_bps_min: p.repayBpsMin,
    repay_bps_max: p.repayBpsMax,
    max_utilization_bps: p.maxUtilizationBps,
    max_exposure_per_merchant: String(p.maxExposurePerMerchant),
    daily_new_merchant_exposure: String(p.dailyNewMerchantExposure),
    min_period_repay_bps: p.minPeriodRepayBps,
    default_after_missed: p.defaultAfterMissed,
    delinquency_provision_bps: p.delinquencyProvisionBps,
    protocol_fee_share_bps: p.protocolFeeShareBps,
    merchant_registration_deposit: String(p.merchantRegistrationDeposit),
  };
}

export function timeJson(t: TimeParams): Record<string, number> {
  return {
    period_sec: t.periodSec,
    withdraw_cooldown_sec: t.withdrawCooldownSec,
    offer_ttl_sec: t.offerTtlSec,
    policy_timelock_sec: t.policyTimelockSec,
  };
}

/** Gateway limits as the INR gateway contract's JSON expects them. */
export function gatewayLimitsJson(g: GatewayProfile): Record<string, unknown> {
  return {
    spread_bps: g.spreadBps,
    min_rate_ppu: g.minRatePpu,
    max_rate_ppu: g.maxRatePpu,
    max_payin_paise: String(g.maxPayinPaise),
    daily_payin_paise: String(g.dailyPayinPaise),
    max_payout_usdc: String(g.maxPayoutUsdc),
  };
}

/** Init arguments for each contract, from a profile (used by deploy scripts and the demo). */
export function initArgs(
  profile: Profile,
  ids: { owner: string; token: string; credit: string; factory: string },
) {
  const inr = {
    owner: ids.owner,
    token: ids.token,
    credit: ids.credit,
    factory: ids.factory,
    limits: gatewayLimitsJson(profile.gateway),
    requires_tee: profile.requiresTee,
    attestation_expiration_time_ms: String(profile.attestationExpirationMs),
  };
  return {
    usdc: { owner: ids.owner },
    factory: {
      credit: ids.credit,
      token: ids.token,
      settlement_init: { bucket_sec: profile.bucketSec, lock_timeout_blocks: profile.lockTimeoutBlocks },
      settlement_balance: String(profile.settlementBalance),
      token_storage: String(profile.tokenStorage),
    },
    credit: {
      owner: ids.owner,
      guardian: ids.owner,
      token: ids.token,
      factory: ids.factory,
      policy: policyJson(profile.policy),
      time: timeJson(profile.time),
      requires_tee: profile.requiresTee,
      attestation_expiration_time_ms: String(profile.attestationExpirationMs),
    },
    inr,
  };
}
