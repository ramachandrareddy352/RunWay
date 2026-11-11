// make sandbox-demo — the full Runway loop on a private local NEAR sandbox (BUILD_PLAN T1.9, G2, T4b.10).
// Time is compressed (300-second revenue buckets) and clearly labelled; no wallet, no real money.
// The underwriter, API/keeper and INR gateway are the real packages, run in-process; only their
// transport differs (sandbox accounts sign instead of ShadeClient). `--inr` adds steps 14–18.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { usdc } from "@runway/config";
import { formatInr, usdcToInr } from "@runway/fx";
import type { NearAccount } from "near-workspaces";
import {
  registerUpi,
  requestOffer,
  runPayouts,
  simulatedUpi,
  startApi,
  startGateway,
  startUnderwriter,
} from "./lib/agents.js";
import {
  advanceSecs,
  advanceToBucket,
  balance,
  check,
  currentBucket,
  deliver,
  deployInrGateway,
  deployStack,
  events,
  fmtUsdc,
  json,
  NEAR,
  ok,
  ONE_YOCTO,
  profile,
  ROOT,
  settle,
  setupLocalAgent,
  StepError,
  TGAS,
  type Stack,
} from "./lib/sandbox.js";

const withInr = process.argv.includes("--inr");
const say = (msg: string) => console.log(`✔ ${msg}`);

interface Loan {
  status: string;
  principal: string;
  owed: string;
  repaid: string;
  principal_repaid: string;
  provisioned: string;
}

async function assertInvariants(s: Stack, settlements: string[], inr?: NearAccount): Promise<void> {
  const v = await s.credit.view<Record<string, string>>("get_vault");
  const bal = await balance(s, s.credit.accountId);
  const cash = BigInt(v.cash!);
  const reserve = BigInt(v.reserve!);
  check(
    bal >= cash + reserve + BigInt(v.merchant_claimable_total!) + BigInt(v.in_transit!),
    "I1: token balance covers cash + reserve + claimable + in-transit",
  );
  const loans = await s.credit.view<Loan[]>("get_active_loans", {});
  let outstanding = 0n;
  let provisions = 0n;
  for (const l of loans) {
    check(
      BigInt(l.principal_repaid) <= BigInt(l.principal) && BigInt(l.repaid) <= BigInt(l.owed),
      "I3: loan bounds",
    );
    outstanding += BigInt(l.principal) - BigInt(l.principal_repaid);
    provisions += BigInt(l.provisioned);
  }
  check(outstanding === BigInt(v.outstanding_principal!), "I2: outstanding principal");
  check(provisions === BigInt(v.provisions!), "I4: provisions");
  check(BigInt(v.reserved!) === 0n, "I2b: nothing reserved at rest");
  const codeHash = await s.factory.view<string>("get_settlement_code_hash");
  for (const id of settlements) {
    const st = await s.root
      .getAccount(id)
      .view<{ op: string | null; pending_repay: string; pending_payout: string }>("get_state");
    if (st.op === null)
      check(
        BigInt(st.pending_repay) + BigInt(st.pending_payout) <= (await balance(s, id)),
        "I6: settlement pendings",
      );
    const keys = await s.root.viewAccessKeys(id);
    check(keys.keys.length === 0, `I7: ${id} has zero access keys`);
    const view = await s.root.getAccount(id).accountView();
    check(view.code_hash === codeHash, `I7: ${id} code hash matches the factory`);
  }
  if (inr) {
    const f = await inr.view<{ free: string; payout_pending: string; refunds_total: string }>("get_float");
    check(
      (await balance(s, inr.accountId)) >=
        BigInt(f.free) + BigInt(f.payout_pending) + BigInt(f.refunds_total),
      "I8: gateway balance covers float + pending payouts + refunds",
    );
  }
}

async function main() {
  const started = Date.now();
  console.log(
    `Runway sandbox demo${withInr ? " (with the INR rail)" : ""} — local NEAR sandbox, time-compressed (bucket = ${profile.bucketSec}s), mock USDC\n`,
  );
  const s = await deployStack();
  try {
    const hashes = readFileSync(join(ROOT, "res", "CODE_HASHES.txt"), "utf8")
      .trim()
      .split("\n");
    say(`sandbox started; contracts deployed\n    ${hashes.join("\n    ")}`);

    await setupLocalAgent(s);
    const uw = await startUnderwriter(s);
    say(
      `Underwriter agent ${s.agent.accountId} registered (Shade local mode: whitelisted, mock measurements); session key published on-chain`,
    );
    const api = startApi(s);

    ok(
      await s.lender.callRaw(
        s.usdc,
        "ft_transfer_call",
        {
          receiver_id: s.credit.accountId,
          amount: String(usdc(10_000)),
          msg: JSON.stringify({ action: "deposit" }),
        },
        { attachedDeposit: ONE_YOCTO, gas: 150n * TGAS },
      ),
      "lender deposit",
    );
    const shares = BigInt(await s.credit.view<string>("ft_balance_of", { account_id: s.lender.accountId }));
    check(shares === usdc(10_000), "lender shares");
    say(`lender deposited 10000.000000 USDC → ${fmtUsdc(shares)} runUSDC`);

    ok(
      await s.owner.callRaw(
        s.usdc,
        "ft_transfer_call",
        {
          receiver_id: s.credit.accountId,
          amount: String(usdc(100)),
          msg: JSON.stringify({ action: "seed_reserve" }),
        },
        { attachedDeposit: ONE_YOCTO, gas: 150n * TGAS },
      ),
      "seed reserve",
    );
    say("owner seeded the first-loss reserve with 100.000000 USDC");

    const deposit = await s.factory.view<string>("required_deposit");
    const reg = ok(
      await s.priya.callRaw(
        s.credit,
        "register_merchant",
        { handle: "priya" },
        { attachedDeposit: BigInt(deposit), gas: 300n * TGAS },
      ),
      "register_merchant",
    );
    check(reg.parseResult<boolean>() === true, "merchant registered");
    const settlement = `priya.${s.factory.accountId}`;
    const keys = await s.root.viewAccessKeys(settlement);
    const codeHash = await s.factory.view<string>("get_settlement_code_hash");
    const view = await s.root.getAccount(settlement).accountView();
    check(
      keys.keys.length === 0 && view.code_hash === codeHash,
      "keyless settlement with the factory's code",
    );
    say(`${settlement} created — access keys: 0, code hash ${codeHash} (matches factory)`);

    // --- 3 buckets of routed revenue. The first arrives through the API's SIMULATED payment (G2):
    //     mock USDC is minted to the settlement account, then the keeper settles it. ---
    const b0 = (await currentBucket(s, settlement)) + 1n;
    const before = [3_900, 4_000, 4_200];
    for (const [i, amount] of before.entries()) {
      await advanceToBucket(s, settlement, b0 + BigInt(i));
      if (i === 0) {
        const p0 = await balance(s, s.priya.accountId);
        const res = await api.app.request("/dev/simulate-payment", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ handle: "priya", amount: String(usdc(amount)) }),
        });
        check(res.status === 201, `simulate-payment: ${res.status} ${await res.text()}`);
        await api.keeper.tick();
        check(
          (await balance(s, s.priya.accountId)) - p0 === usdc(amount),
          "keeper settled the simulated payment",
        );
        const listed = (await (await api.app.request("/payments/priya")).json()) as {
          kind: string;
          settledTx: string | null;
        }[];
        check(
          listed.length === 1 && listed[0]!.kind === "simulated" && listed[0]!.settledTx,
          "payment log shows it settled",
        );
        say(
          `SIMULATED (testnet-style) payment of ${amount} USDC via POST /dev/simulate-payment → keeper settled it 100% to Priya`,
        );
      } else {
        await deliver(s, settlement, usdc(amount));
        await settle(s, settlement);
      }
    }
    await advanceToBucket(s, settlement, b0 + 3n);
    say(`3 buckets of routed revenue: ${before.join(" / ")} USDC (each settled 100% to Priya, no loan)`);

    // --- offer #1 (sealed request → real underwriter pipeline) ---
    const o1 = await requestOffer(s, uw, "priya", s.priya);
    check(o1.decision === "offer" && o1.offer_id && o1.terms, `offer #1 expected, got ${json(o1)}`);
    const t1 = o1.terms;
    check(
      t1.grade === "C" && BigInt(t1.limit) === usdc(500) && t1.repay_bps === 500,
      `offer #1 terms ${json(t1)}`,
    );
    say(
      `offer #1 via sealed /underwrite (NEP-413 + session key checked on-chain; revenue: sandbox-buckets; anchor: sandbox fixture, not KYC): ` +
        `grade ${t1.grade}, limit ${fmtUsdc(t1.limit)}, fee ${t1.fee_bps / 100}%, repay ${(t1.repay_bps / 100).toFixed(2)}%; ` +
        `commitment recomputed from the sealed inputs`,
    );

    const p0 = await balance(s, s.priya.accountId);
    ok(
      await s.priya.callRaw(
        s.credit,
        "accept_offer",
        { offer_id: o1.offer_id, amount: t1.limit },
        { attachedDeposit: ONE_YOCTO, gas: 300n * TGAS },
      ),
      "accept #1",
    );
    const m1 = await s.credit.view<{ merchant: { active_loan: string } }>("get_merchant", {
      handle: "priya",
    });
    const loan1 = m1.merchant.active_loan;
    const l1 = await s.credit.view<Loan>("get_loan", { loan_id: loan1 });
    check(
      l1.status === "Active" && (await balance(s, s.priya.accountId)) - p0 === usdc(500),
      "loan #1 disbursed",
    );
    say(
      `loan #1 ${fmtUsdc(l1.principal)} disbursed (PendingTerms → PendingTransfer → Active); owed ${fmtUsdc(l1.owed)}`,
    );

    // --- repay loan #1 from 3 more buckets of routed revenue ---
    const during = [4_000, 4_100, 3_900];
    for (const [i, amount] of during.entries()) {
      await advanceToBucket(s, settlement, b0 + 3n + BigInt(i));
      await deliver(s, settlement, usdc(amount));
      await settle(s, settlement);
    }
    const r1 = await s.credit.view<Loan>("get_loan", { loan_id: loan1 });
    check(r1.status === "Repaid" && r1.principal_repaid === r1.principal, "loan #1 repaid");
    const rec = await s.credit.view<{ record: { loans_repaid: number } }>("get_merchant", {
      handle: "priya",
    });
    check(rec.record.loans_repaid === 1, "credit record shows 1 repaid loan");
    say(`loan #1 repaid automatically from routed payments (${during.join(" / ")} USDC); loans_repaid = 1`);
    await advanceToBucket(s, settlement, b0 + 6n);

    // --- offer #2 ---
    const o2 = await requestOffer(s, uw, "priya", s.priya);
    const t2 = o2.terms;
    check(
      o2.decision === "offer" &&
        o2.offer_id &&
        t2 &&
        t2.grade === "B" &&
        BigInt(t2.limit) === usdc(2_000) &&
        t2.repay_bps === 1784,
      `offer #2 terms ${json(o2)}`,
    );
    say(
      `offer #2: grade ${t2.grade}, limit ${fmtUsdc(t2.limit)}, fee ${t2.fee_bps / 100}%, repay ${(t2.repay_bps / 100).toFixed(2)}%`,
    );
    ok(
      await s.priya.callRaw(
        s.credit,
        "accept_offer",
        { offer_id: o2.offer_id, amount: t2.limit },
        { attachedDeposit: ONE_YOCTO, gas: 300n * TGAS },
      ),
      "accept #2",
    );
    const m2 = await s.credit.view<{ merchant: { active_loan: string } }>("get_merchant", {
      handle: "priya",
    });
    const loan2 = m2.merchant.active_loan;
    const l2 = await s.credit.view<Loan>("get_loan", { loan_id: loan2 });
    check(l2.status === "Active", "loan #2 active");
    say(`loan #2 ${fmtUsdc(l2.principal)} Active; owed ${fmtUsdc(l2.owed)}`);

    // --- the split ---
    const pBefore = await balance(s, s.priya.accountId);
    await deliver(s, settlement, usdc(1_000));
    const r = await settle(s, settlement);
    const ev = events(r, "settled")[0]!;
    check(
      BigInt(ev.repay_applied as string) === 178_400_000n && BigInt(ev.payout as string) === 821_600_000n,
      "split",
    );
    check((await balance(s, s.priya.accountId)) - pBefore === 821_600_000n, "priya received her share");
    say(
      `settle: ${fmtUsdc(usdc(1_000))} in → repay ${fmtUsdc(ev.repay_applied as string)} / payout ${fmtUsdc(ev.payout as string)}`,
    );

    // --- lender withdrawal (cooldown, priced at claim) ---
    const req = ok(
      await s.lender.callRaw(
        s.credit,
        "request_withdraw",
        { shares: String(usdc(1_000)) },
        { attachedDeposit: ONE_YOCTO, gas: 50n * TGAS },
      ),
      "request_withdraw",
    );
    const reqId = req.parseResult<string>();
    await advanceSecs(s, profile.time.withdrawCooldownSec + 1);
    const lBefore = await balance(s, s.lender.accountId);
    ok(
      await s.lender.callRaw(s.credit, "claim_withdraw", { request_id: reqId }, { gas: 100n * TGAS }),
      "claim_withdraw",
    );
    const got = (await balance(s, s.lender.accountId)) - lBefore;
    check(got > usdc(1_000), "lender earned fees");
    say(`lender withdrew 1000.000000 runUSDC → ${fmtUsdc(got)} USDC (priced at claim, after the cooldown)`);

    await assertInvariants(s, [settlement]);
    say("invariants I1–I4, I2b, I6, I7 hold");
    console.log(`\nDEMO PASSED in ${Math.round((Date.now() - started) / 1000)}s`);

    if (withInr) await inrDemo(s, settlement, loan2, started);
  } finally {
    await s.worker.tearDown().catch(() => undefined);
  }
}

/** T4b.10 steps 14–18: fixed oracle ₹85, spread 0, mock provider (SIMULATED UPI), real gateway agent code. */
async function inrDemo(s: Stack, settlement: string, loan2: string, started: number): Promise<void> {
  console.log("\nINR rail (SIMULATED UPI: mock provider, fixed ₹85.00/USDC, spread 0)\n");
  // 14
  const { inr, gwagent } = await deployInrGateway(s);
  const g = await startGateway(s, inr, gwagent);
  say(
    `inr-gateway deployed at ${inr.accountId}; credit.inr_gateway set; local InrGateway agent ${gwagent.accountId}; float 1000.000000 USDC`,
  );

  // 15: investor ₹ deposit → shares at the current share price
  const investor = await s.root.createSubAccount("investor2", { initialBalance: 20n * NEAR });
  ok(
    await investor.callRaw(
      s.credit,
      "storage_deposit",
      { account_id: investor.accountId, registration_only: true },
      { attachedDeposit: NEAR / 100n },
    ),
    "investor2 share storage",
  );
  ok(
    await s.owner.callRaw(
      s.usdc,
      "storage_deposit",
      { account_id: investor.accountId, registration_only: true },
      { attachedDeposit: NEAR / 100n },
    ),
    "investor2 usdc storage",
  );
  const v = await s.credit.view<{ total_shares: string; total_assets: string }>("get_vault");
  const V = 1_000_000n;
  const expectShares = (usdc(100) * (BigInt(v.total_shares) + V)) / (BigInt(v.total_assets) + V);
  const dep = await simulatedUpi(g, {
    kind: "lender_deposit",
    beneficiary: investor.accountId,
    amount_paise: "850000",
  });
  check(dep.status === "delivered" && dep.usdc === usdc(100), `₹ deposit ${json(dep)}`);
  const invShares = BigInt(await s.credit.view<string>("ft_balance_of", { account_id: investor.accountId }));
  check(invShares === expectShares, `shares ${invShares} = floor(100e6 × (S+V)/(A+V)) = ${expectShares}`);
  say(
    `investor2 paid ${formatInr(850_000n)} by SIMULATED UPI → 100.000000 USDC deposited → ${fmtUsdc(invShares)} runUSDC at the current share price`,
  );

  // 16: a UPI sale for Priya → 100 USDC to priya.pay → settle splits at loan #2's 17.84%
  const sale1 = await simulatedUpi(g, { kind: "merchant_sale", handle: "priya", amount_paise: "850000" });
  check(sale1.status === "delivered", `sale ${json(sale1)}`);
  const r16 = await settle(s, settlement);
  const e16 = events(r16, "settled")[0]!;
  check(
    BigInt(e16.repay_applied as string) === 17_840_000n && BigInt(e16.payout as string) === 82_160_000n,
    `split ${json(e16)}`,
  );
  say(
    `customer paid Priya ${formatInr(850_000n)} by SIMULATED UPI → 100 USDC to ${settlement} → settle: repay 17.840000 / payout 82.160000 (loan #${loan2})`,
  );

  // 17: Priya takes payouts in rupees
  ok(
    await s.priya.callRaw(
      s.credit,
      "set_payout_mode",
      { mode: "Inr" },
      { attachedDeposit: ONE_YOCTO, gas: 30n * TGAS },
    ),
    "set_payout_mode",
  );
  const masked = await registerUpi(s, g, inr, s.priya, "priya@upi");
  const sale2 = await simulatedUpi(g, { kind: "merchant_sale", handle: "priya", amount_paise: "850000" });
  check(sale2.status === "delivered", `sale 2 ${json(sale2)}`);
  ok(await settle(s, settlement), "settle in Inr mode");
  await runPayouts(g);
  const p1 = await inr.view<{
    status: string;
    inr_paise: string;
    utr_hash: string;
    usdc: string;
    kind: string;
  }>("get_payout", {
    payout_id: "1",
  });
  check(
    p1.kind === "merchant_share" &&
      p1.status === "Paid" &&
      p1.usdc === "82160000" &&
      p1.inr_paise === "698360" &&
      p1.utr_hash,
    `merchant ₹ payout ${json(p1)}`,
  );
  say(
    `Priya set payout_mode = Inr and registered ${masked}; next ₹8,500 sale → 82.160000 USDC → mock payout Paid: ${formatInr(698_360n)} (82.16 × 85), UTR hash ${p1.utr_hash}`,
  );

  // 18: investor ₹ withdrawal
  await registerUpi(s, g, inr, investor, "investor2@upi");
  const all = BigInt(await s.credit.view<string>("ft_balance_of", { account_id: investor.accountId }));
  const wreq = ok(
    await investor.callRaw(
      s.credit,
      "request_withdraw",
      { shares: String(all), payout: "Inr" },
      { attachedDeposit: ONE_YOCTO, gas: 50n * TGAS },
    ),
    "investor2 request_withdraw",
  );
  await advanceSecs(s, profile.time.withdrawCooldownSec + 1);
  ok(
    await investor.callRaw(
      s.credit,
      "claim_withdraw",
      { request_id: wreq.parseResult<string>() },
      { gas: 150n * TGAS },
    ),
    "investor2 claim",
  );
  await runPayouts(g);
  const p2 = await inr.view<{
    status: string;
    inr_paise: string;
    usdc: string;
    kind: string;
    utr_hash: string;
  }>("get_payout", {
    payout_id: "2",
  });
  const expectedPaise = usdcToInr(BigInt(p2.usdc), 8_500, 0);
  check(
    p2.kind === "lender_withdrawal" && p2.status === "Paid" && BigInt(p2.inr_paise) === expectedPaise,
    `investor ₹ payout ${json(p2)}`,
  );
  check(Boolean(p2.utr_hash), "UTR hash recorded");
  say(
    `investor2 withdrew all ${fmtUsdc(all)} runUSDC in rupees → ${fmtUsdc(p2.usdc)} USDC → mock payout Paid: ${formatInr(expectedPaise)} (USDC × 85)`,
  );

  await assertInvariants(s, [settlement], inr);
  say("invariants I1–I8 hold");
  console.log(`\nDEMO (INR) PASSED in ${Math.round((Date.now() - started) / 1000)}s`);
}

main().catch((e: unknown) => {
  console.error(e instanceof StepError ? `✖ ${e.message}` : e);
  process.exit(1);
});
