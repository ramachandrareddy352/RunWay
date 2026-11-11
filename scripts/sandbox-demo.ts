// make sandbox-demo — the full Runway loop on a private local NEAR sandbox (BUILD_PLAN T1.9).
// Time is compressed (60-second revenue buckets) and clearly labelled; no wallet, no real money.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { usdc } from "@runway/config";
import { underwrite } from "./lib/local-underwriter.js";
import {
  advanceSecs,
  advanceToBucket,
  balance,
  check,
  currentBucket,
  deliver,
  deployStack,
  events,
  fmtUsdc,
  json,
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

const say = (msg: string) => console.log(`✔ ${msg}`);

interface Loan {
  status: string;
  principal: string;
  owed: string;
  repaid: string;
  principal_repaid: string;
  provisioned: string;
}

async function assertInvariants(s: Stack, settlements: string[]): Promise<void> {
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
}

async function main() {
  const started = Date.now();
  console.log(
    `Runway sandbox demo — local NEAR sandbox, time-compressed (bucket = ${profile.bucketSec}s), mock USDC\n`,
  );
  const s = await deployStack();
  try {
    const hashes = readFileSync(join(ROOT, "res", "CODE_HASHES.txt"), "utf8")
      .trim()
      .split("\n");
    say(`sandbox started; contracts deployed\n    ${hashes.join("\n    ")}`);

    await setupLocalAgent(s);
    say(
      `local Underwriter agent ${s.agent.accountId} registered (Shade local mode: whitelisted, mock measurements)`,
    );

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

    // --- 3 buckets of routed revenue (1Click-style plain ft_transfer deliveries) ---
    // Start at the next bucket boundary, so each delivery gets a whole bucket to itself.
    const b0 = (await currentBucket(s, settlement)) + 1n;
    const before = [3_900, 4_000, 4_200];
    for (const [i, amount] of before.entries()) {
      await advanceToBucket(s, settlement, b0 + BigInt(i));
      await deliver(s, settlement, usdc(amount));
      await settle(s, settlement);
    }
    await advanceToBucket(s, settlement, b0 + 3n);
    say(`3 buckets of routed revenue: ${before.join(" / ")} USDC (each settled 100% to Priya, no loan)`);

    // --- offer #1 ---
    const u1 = await underwrite(s, "priya", settlement);
    check(
      u1.decision.kind === "offer" && u1.offerId,
      `offer #1 expected, got ${json({ decision: u1.decision, buckets: u1.buckets })}`,
    );
    const d1 = u1.decision;
    check(
      d1.kind === "offer" && d1.grade === "C" && d1.limit === usdc(500) && d1.repayBps === 500,
      "offer #1 terms",
    );
    say(
      `offer #1 (revenue: sandbox-buckets, payers: unknown, anchor: sandbox fixture — not KYC): grade ${d1.grade}, ` +
        `limit ${fmtUsdc(d1.limit)}, fee ${d1.feeBps / 100}%, repay ${(d1.repayBps / 100).toFixed(2)}%`,
    );

    const p0 = await balance(s, s.priya.accountId);
    ok(
      await s.priya.callRaw(
        s.credit,
        "accept_offer",
        { offer_id: u1.offerId, amount: String(d1.limit) },
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
    const u2 = await underwrite(s, "priya", settlement);
    const d2 = u2.decision;
    check(
      d2.kind === "offer" &&
        u2.offerId &&
        d2.grade === "B" &&
        d2.limit === usdc(2_000) &&
        d2.repayBps === 1784,
      `offer #2 terms ${json(d2)}`,
    );
    say(
      `offer #2: grade ${d2.grade}, limit ${fmtUsdc(d2.limit)}, fee ${d2.feeBps / 100}%, repay ${(d2.repayBps / 100).toFixed(2)}% ` +
        `(window ${u2.buckets.map((b) => fmtUsdc(b).split(".")[0]).join("/")})`,
    );
    ok(
      await s.priya.callRaw(
        s.credit,
        "accept_offer",
        { offer_id: u2.offerId, amount: String(d2.limit) },
        { attachedDeposit: ONE_YOCTO, gas: 300n * TGAS },
      ),
      "accept #2",
    );
    const m2 = await s.credit.view<{ merchant: { active_loan: string } }>("get_merchant", {
      handle: "priya",
    });
    const l2 = await s.credit.view<Loan>("get_loan", { loan_id: m2.merchant.active_loan });
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
  } finally {
    await s.worker.tearDown().catch(() => undefined);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof StepError ? `✖ ${e.message}` : e);
  process.exit(1);
});
