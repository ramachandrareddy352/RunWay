// End-to-end run on NEAR testnet against a running `services/node` (X2/X5 without a browser): what the
// web app does, over HTTP, signed with the demo accounts' keys from ~/.near-credentials/testnet.
//   pnpm --filter @runway/node start                       # in another terminal
//   pnpm --filter @runway/scripts testnet-e2e [--handle priya --account priya.<root>] [--skip-revenue]
// Revenue buckets are 300 s on testnet and can't be fast-forwarded, so a full run takes ~30 minutes.
// Every payment here is SIMULATED (mock USDC, mock UPI). Results go to deployments/testnet-e2e.json.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deploymentFor, profiles, usdc } from "@runway/config";
import {
  beneficiaryMessage,
  BENEFICIARY_CONTEXT,
  checkSession,
  creditViews,
  GATEWAY_RECIPIENT,
  inrViews,
  newX25519Keypair,
  openJson,
  sealJson,
  settlementViews,
  signNep413,
  underwriteMessage,
  UNDERWRITE_CONTEXT,
  UNDERWRITE_RECIPIENT,
  UNDERWRITE_RESPONSE_CONTEXT,
  verifyCommitment,
  viewAgreed,
  type AgentRole,
  type AgentView,
  type PayoutRequest,
  type Sealed,
  type ServedSession,
  type Viewer,
} from "@runway/sdk";
import { call, chainFor, TGAS } from "./lib/near.js";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name: string, d: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : d;
};
const R = process.env.RUNWAY_ROOT ?? "runway-rama.testnet";
const NODE = process.env.RUNWAY_NODE_URL ?? "http://localhost:8787";
const API = `${NODE}/api`;
const UW = `${NODE}/uw`;
const GW = `${NODE}/gw`;
const FRESH = process.argv.includes("--fresh");
// --fresh: a new merchant (account e2e<id>.<root>, handle e2e<id>) so old buckets don't enter the window.
const FRESH_ID = Date.now().toString(36).slice(-6);
const HANDLE = FRESH ? `e2e${FRESH_ID}` : arg("handle", "priya");
const MERCHANT = FRESH ? `e2e${FRESH_ID}.${R}` : arg("account", `priya.${R}`);
const INVESTOR = arg("investor", `investor.${R}`);
const d = deploymentFor(R);
const rpcs = profiles.testnet.rpcUrls;
const view: Viewer = (c, m, a) => viewAgreed(c, m, a, { rpcs });
const credit = creditViews(view, d.credit);
const inr = inrViews(view, d.inr);
const settlements = settlementViews(view);
const report: Record<string, unknown> = {
  started_at: new Date().toISOString(),
  node: NODE,
  handle: HANDLE,
  steps: [] as unknown[],
};
const steps = report.steps as unknown[];

const say = (m: string, data?: Record<string, unknown>) => {
  console.log(`✔ ${m}`);
  steps.push({ at: new Date().toISOString(), step: m, ...data });
  writeFileSync(join(ROOT_DIR, "deployments", "testnet-e2e.json"), `${JSON.stringify(report, null, 2)}\n`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function http<T>(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

async function until<T>(
  what: string,
  f: () => Promise<T | undefined | null | false>,
  timeoutMs = 180_000,
  everyMs = 5_000,
): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last = "";
  for (;;) {
    const v = await f().catch((e: unknown) => {
      last = (e as Error).message;
      return undefined;
    });
    if (v) return v as T;
    if (Date.now() > end)
      throw new Error(`timed out waiting for ${what}${last ? ` (last error: ${last.slice(0, 200)})` : ""}`);
    await sleep(everyMs);
  }
}

async function session(base: string, role: AgentRole, getAgent: (id: string) => Promise<AgentView | null>) {
  const served = await http<ServedSession>("GET", `${base}/session`);
  const s = await checkSession(served, getAgent, { role });
  if (!s.ok) throw new Error(`${role} session check failed: ${s.reason}`);
  return s;
}

async function sealedPost<T>(url: string, body: unknown, pub: Uint8Array, ctx: string) {
  const me = newX25519Keypair();
  const { sealed } = sealJson(body, pub, ctx, me);
  const reply = await http<T>("POST", url, sealed);
  return { reply, me };
}

/** SIMULATED payment through the API, then wait until its keeper settled it. */
async function payAndSettle(amount: bigint): Promise<string> {
  const r = await http<{ depositAddress: string }>("POST", `${API}/dev/simulate-payment`, {
    handle: HANDLE,
    amount: amount.toString(),
  });
  const p = await until(
    `keeper settle of ${r.depositAddress}`,
    async () =>
      (
        await http<{ depositAddress: string; settledTx: string | null }[]>("GET", `${API}/payments/${HANDLE}`)
      ).find((x) => x.depositAddress === r.depositAddress && x.settledTx),
    120_000,
  );
  return p.settledTx!;
}

async function upi(kind: Record<string, string>): Promise<{ id: string; hash: string; usdc: string }> {
  const c = await http<{
    collect_id: string;
    usdc_estimate: string;
    simulated: boolean;
    rate_ppu_estimate: number;
  }>("POST", `${GW}/inr/collect`, kind);
  if (!c.simulated) throw new Error("expected the SIMULATED provider");
  await http("POST", `${GW}/mock/upi/${c.collect_id}/success`, undefined, { accept: "application/json" });
  const st = await until(
    `collect ${c.collect_id} delivered`,
    async () => {
      const s = await http<{ status: string; payment_ref_hash?: string; reason?: string }>(
        "GET",
        `${GW}/inr/collect/${c.collect_id}`,
      );
      if (s.status === "failed") throw new Error(`collect failed: ${s.reason}`);
      return s.status === "delivered" ? s : undefined;
    },
    120_000,
    3_000,
  );
  return { id: c.collect_id, hash: st.payment_ref_hash!, usdc: c.usdc_estimate };
}

async function payoutsFor(account: string): Promise<PayoutRequest[]> {
  const out: PayoutRequest[] = [];
  for (let id = 1; id < 500; id++) {
    const p = await inr.payout(String(id));
    if (!p) break;
    if (p.beneficiary === account) out.push(p);
  }
  return out;
}

async function main() {
  const c = await chainFor("testnet", rpcs[0]!);
  const keyOf = async (id: string) => {
    const k = await c.keyStore.getKey("testnet", id);
    if (!k) throw new Error(`no key for ${id} in ~/.near-credentials/testnet`);
    return k.toString();
  };
  if (FRESH) {
    const rootAcc = await c.account(R);
    const kp = await c.newKey(MERCHANT);
    await rootAcc.createAccount(MERCHANT, kp.getPublicKey(), 3n * 10n ** 24n);
    await call(
      rootAcc,
      d.token,
      "storage_deposit",
      { account_id: MERCHANT, registration_only: true },
      { deposit: 125n * 10n ** 20n, gas: 30n * TGAS },
    );
    const fresh = await c.account(MERCHANT);
    const deposit = BigInt((await view(d.factory, "required_deposit", {})) as string);
    const reg = await call(
      fresh,
      d.credit,
      "register_merchant",
      { handle: HANDLE },
      { deposit, gas: 300n * TGAS },
    );
    say(`fresh merchant ${HANDLE} (${MERCHANT}) registered`, { tx: reg.hash });
  }
  const merchant = await c.account(MERCHANT);
  const investor = await c.account(INVESTOR);
  console.log(
    `Runway testnet E2E — node ${NODE}, merchant ${HANDLE} (${MERCHANT}). Every payment is SIMULATED.\n`,
  );

  // 0. services
  const root = await http<{ agents: Record<string, string>; inr_provider: string }>("GET", `${NODE}/`);
  const uwHealth = await http<{ registered: boolean }>("GET", `${UW}/health`);
  const gwHealth = await http<{
    registered: boolean;
    oracle: { rate_ppu: number; paused: boolean; sources: string[] };
  }>("GET", `${GW}/health`);
  if (!uwHealth.registered || !gwHealth.registered)
    throw new Error("an agent is not registered on-chain (run deploy-testnet)");
  if (gwHealth.oracle.paused) throw new Error("the FX oracle is paused (sources disagree or are down)");
  say("services up", { agents: root.agents, provider: root.inr_provider, fx: gwHealth.oracle });

  const m = await credit.merchant(HANDLE);
  if (!m) throw new Error(`merchant ${HANDLE} is not registered`);
  if (m.merchant.payout !== MERCHANT)
    throw new Error(`${HANDLE} pays out to ${m.merchant.payout}, not ${MERCHANT}`);
  const settlement = m.merchant.settlement;
  if (m.merchant.payout_mode === "Inr")
    await call(merchant, d.credit, "set_payout_mode", { mode: "Usdc" }, { deposit: 1n, gas: 30n * TGAS });

  // 1. an existing loan from an earlier run gets repaid first
  if (m.merchant.active_loan) {
    const id = m.merchant.active_loan;
    for (let i = 0; i < 10 && (await credit.loan(id))?.status !== "Repaid"; i++)
      await payAndSettle(usdc(2_000));
    say(`earlier loan #${id} repaid from SIMULATED payments`);
  }

  // 2. three buckets of routed revenue (300 s each, real time)
  if (!process.argv.includes("--skip-revenue")) {
    for (const amount of [3_900, 4_000, 4_200]) {
      const b = BigInt((await settlements.state(settlement)).current_bucket);
      const tx = await payAndSettle(usdc(amount));
      say(`bucket ${b}: SIMULATED payment ${amount} USDC settled`, { tx });
      // The offer needs complete buckets, so wait out the current one after each payment.
      console.log(`  waiting for bucket ${b + 1n} (up to 5 minutes)…`);
      await until(
        `bucket ${b + 1n}`,
        async () => BigInt((await settlements.state(settlement)).current_bucket) > b,
        400_000,
        10_000,
      );
    }
  }

  // 3. offer: session key checked on-chain, NEP-413, sealed request (+ a statement for NEAR AI)
  const uw = await session(UW, "Underwriter", credit.agent);
  const nep413 = signNep413(
    { message: underwriteMessage(HANDLE), recipient: UNDERWRITE_RECIPIENT },
    MERCHANT,
    await keyOf(MERCHANT),
  );
  const csv =
    "month,description,incoming_usd\n2026-06,client payments,3900.00\n2026-07,client payments,4000.00\n2026-08,client payments,4200.00\n";
  const statements = [
    { name: "statement.csv", mime: "text/csv", data_b64: Buffer.from(csv).toString("base64") },
  ];
  const { reply: offer, me } = await sealedPost<{
    decision: string;
    offer_id?: string;
    reasons: string[];
    terms?: { grade: string; limit: string; fee_bps: number; repay_bps: number };
    sealed: Sealed;
  }>(`${UW}/underwrite`, { handle: HANDLE, nep413, statements }, uw.sessionPub, UNDERWRITE_CONTEXT);
  if (offer.decision !== "offer" || !offer.offer_id || !offer.terms)
    throw new Error(
      `declined: ${offer.reasons.join("; ")} (re-run with a fresh merchant if old history is in the window)`,
    );
  const opened = openJson<{ inputs: unknown; salt: string; commitment: string }>(
    offer.sealed,
    me,
    UNDERWRITE_RESPONSE_CONTEXT,
  );
  // submit_offer returns at optimistic finality; the two-RPC read is at the final block, a few seconds behind.
  const offerId = offer.offer_id;
  const onChain = await until("offer visible at the final block", () => credit.offer(offerId), 60_000, 2_000);
  if (!verifyCommitment(onChain.inputs_commitment, opened.inputs, opened.salt))
    throw new Error("commitment does not match");
  say(
    `offer #${offer.offer_id}: grade ${offer.terms.grade}, limit ${offer.terms.limit}, fee ${offer.terms.fee_bps} bps, repay ${offer.terms.repay_bps} bps; commitment verified`,
    {
      reasons: offer.reasons,
      llm_receipt_hash: onChain.llm_receipt_hash,
    },
  );

  // 4. accept → Active
  const before = BigInt((await view(d.token, "ft_balance_of", { account_id: MERCHANT })) as string);
  const acc = await call(
    merchant,
    d.credit,
    "accept_offer",
    { offer_id: offer.offer_id, amount: offer.terms.limit },
    { deposit: 1n, gas: 300n * TGAS },
  );
  const mm = await until(
    "loan id",
    async () => (await credit.merchant(HANDLE))?.merchant.active_loan,
    60_000,
  );
  const loan = await until(
    "loan Active",
    async () => {
      const l = await credit.loan(mm);
      return l?.status === "Active" ? l : undefined;
    },
    60_000,
  );
  const after = BigInt((await view(d.token, "ft_balance_of", { account_id: MERCHANT })) as string);
  say(`loan #${loan.id} Active; ${after - before} µUSDC disbursed to ${MERCHANT}`, {
    tx: acc.hash,
    owed: loan.owed,
  });

  // 5. repayment from routed payments
  for (let i = 0; i < 6; i++) {
    const tx = await payAndSettle(usdc(1_200));
    const l = await credit.loan(loan.id);
    say(`SIMULATED 1200 USDC settled: loan repaid ${l?.repaid}/${l?.owed}`, { tx });
    if (l?.status === "Repaid") break;
  }
  if ((await credit.loan(loan.id))?.status !== "Repaid") throw new Error("loan not repaid");

  // 6. a UPI sale (SIMULATED) → receipt on-chain → keeper settles it
  const sale = await upi({ kind: "merchant_sale", handle: HANDLE, amount_paise: "850000" });
  const receipt = await inr.receipt(sale.hash);
  await until("keeper settles the UPI sale", async () =>
    (
      await http<{ depositAddress: string; settledTx: string | null }[]>("GET", `${API}/payments/${HANDLE}`)
    ).find((x) => x.depositAddress === `upi-${sale.hash}` && x.settledTx),
  );
  say(
    `UPI sale ₹8,500.00 → ${receipt?.delivered} µUSDC at ₹${(receipt?.rate_ppu ?? 0) / 100}/USDC to ${settlement}, settled`,
    { payment_ref_hash: sale.hash },
  );

  // 7. rupee payouts for the merchant
  await call(merchant, d.credit, "set_payout_mode", { mode: "Inr" }, { deposit: 1n, gas: 30n * TGAS });
  const gw = await session(GW, "InrGateway", inr.agent);
  const register = async (who: string, vpa: string) => {
    const auth = signNep413(
      { message: beneficiaryMessage(who), recipient: GATEWAY_RECIPIENT },
      who,
      await keyOf(who),
    );
    const { reply } = await sealedPost<{ masked: string }>(
      `${GW}/inr/beneficiary`,
      { type: "vpa", nep413_auth: auth, account_id: who, name: who.split(".")[0], vpa },
      gw.sessionPub,
      BENEFICIARY_CONTEXT,
    );
    return reply.masked;
  };
  const masked = await register(MERCHANT, `${HANDLE}@upi`);
  const paidBefore = (await payoutsFor(MERCHANT)).length;
  const sale2 = await upi({ kind: "merchant_sale", handle: HANDLE, amount_paise: "850000" });
  const payout = await until(
    "merchant ₹ payout Paid",
    async () => {
      const ps = await payoutsFor(MERCHANT);
      const p = ps.length > paidBefore ? ps[ps.length - 1] : undefined;
      return p?.status === "Paid" ? p : undefined;
    },
    240_000,
    10_000,
  );
  say(
    `payout mode ₹, beneficiary ${masked}; next UPI sale → payout #${payout.id} Paid: ${payout.usdc} µUSDC → ${payout.inr_paise} paise`,
    {
      payment_ref_hash: sale2.hash,
      utr_hash: payout.utr_hash,
    },
  );
  await call(merchant, d.credit, "set_payout_mode", { mode: "Usdc" }, { deposit: 1n, gas: 30n * TGAS });

  // 8. investor: ₹ deposit → shares; ₹ withdrawal → Paid
  const sharesBefore = BigInt(await credit.shares(INVESTOR));
  const dep = await upi({ kind: "lender_deposit", beneficiary: INVESTOR, amount_paise: "850000" });
  const sharesAfter = BigInt(await credit.shares(INVESTOR));
  if (sharesAfter <= sharesBefore) throw new Error("no shares minted");
  say(`investor ₹8,500.00 deposit → ${sharesAfter - sharesBefore} runUSDC shares`, {
    payment_ref_hash: dep.hash,
  });
  await register(INVESTOR, "investor@upi");
  const req = await call<string>(
    investor,
    d.credit,
    "request_withdraw",
    { shares: sharesAfter.toString(), payout: "Inr" },
    { deposit: 1n, gas: 50n * TGAS },
  );
  const cooldown = profiles.testnet.time.withdrawCooldownSec;
  console.log(`  withdrawal request #${req.value}: waiting the ${cooldown}s cooldown…`);
  await sleep((cooldown + 10) * 1000);
  const claim = await call(
    investor,
    d.credit,
    "claim_withdraw",
    { request_id: req.value },
    { gas: 150n * TGAS },
  );
  const wp = await until(
    "investor ₹ payout Paid",
    async () => {
      const p = (await payoutsFor(INVESTOR)).filter((x) => x.kind === "lender_withdrawal").pop();
      return p?.status === "Paid" ? p : undefined;
    },
    240_000,
    10_000,
  );
  say(`investor ₹ withdrawal → payout #${wp.id} Paid: ${wp.usdc} µUSDC → ${wp.inr_paise} paise`, {
    request_tx: req.hash,
    claim_tx: claim.hash,
  });

  report.finished_at = new Date().toISOString();
  say("TESTNET E2E PASSED");
}

main().catch((e: unknown) => {
  console.error(`✖ ${(e as Error).message}`);
  report.error = (e as Error).message;
  writeFileSync(join(ROOT_DIR, "deployments", "testnet-e2e.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.exit(1);
});
