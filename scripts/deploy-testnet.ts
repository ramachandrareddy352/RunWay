// Testnet deployment (BUILD_PLAN T2.4, runbook §8.2 and §8.5). Idempotent: every step checks the chain
// first, so a failed run can simply be repeated.
//
//   pnpm --filter @runway/scripts deploy-testnet            # deploy + seed (skips what exists)
//   pnpm --filter @runway/scripts deploy-testnet --verify   # checks only
//
// Signs with near CLI's legacy keychain (~/.near-credentials/testnet): the root and keeper keys must
// be there. New accounts get fresh keys saved in the same place. Writes:
//   deployments/testnet.json   public: accounts, code hashes, transaction hashes (committed)
//   .env.agents.local          secret: the local-mode agent keys (git-ignored via .env.*)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deploymentFor, initArgs, profiles, usdc } from "@runway/config";
import { defaultPpid, mockAttestation, mockMeasurements } from "@runway/config/fixtures";
import { base58Encode } from "@runway/sdk";
import { call, chainFor, near, testnetRpcs, TGAS, view, type Chain } from "./lib/near.js";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT_DIR, "deployments", "testnet.json");
const AGENT_ENV = join(ROOT_DIR, ".env.agents.local");
const RPCS = testnetRpcs();
const NODE_URL = RPCS[0]!;
const R = process.env.RUNWAY_ROOT ?? "runway-rama.testnet";
const KEEPER = process.env.KEEPER_ACCOUNT_ID ?? `keeper.${R}`;
const profile = profiles.testnet;
const d = deploymentFor(R);
const verifyOnly = process.argv.includes("--verify");
const EMPTY_CODE = "11111111111111111111111111111111";
const HAVE_WASM = existsSync(join(ROOT_DIR, "res", "CODE_HASHES.txt"));

const ACCOUNTS = {
  token: d.token,
  factory: d.factory,
  credit: d.credit,
  inr: d.inr,
  underwriter: `uwagent.${R}`,
  gateway: `gwagent.${R}`,
  lender: `lender.${R}`,
  priya: `priya.${R}`,
  investor: `investor.${R}`,
};
/** NEAR to create each account with (contract storage at ~1 NEAR per 100 KB, plus headroom). */
const FUNDING: Record<keyof typeof ACCOUNTS, number> = {
  token: 2.5,
  factory: 4,
  credit: 12.5,
  inr: 10.5,
  underwriter: 1,
  gateway: 1,
  lender: 1.5,
  priya: 3.5,
  investor: 1.5,
};
const WASM: Partial<Record<keyof typeof ACCOUNTS, string>> = {
  token: "runway_mock_usdc",
  factory: "runway_factory",
  credit: "runway_credit",
  inr: "runway_inr_gateway",
};

interface Record_ {
  network: "testnet";
  root: string;
  keeper: string;
  rpc: string;
  accounts: typeof ACCOUNTS;
  settlement_priya: string;
  code_hashes: Record<string, string>;
  /** The settlement wasm the factory embeds (for --verify without a local build). */
  settlement_code_hash?: string;
  steps: Record<string, string>;
  updated_at: string;
}

const record: Record_ = existsSync(OUT)
  ? (JSON.parse(readFileSync(OUT, "utf8")) as Record_)
  : {
      network: "testnet",
      root: R,
      keeper: KEEPER,
      rpc: NODE_URL,
      accounts: ACCOUNTS,
      settlement_priya: `priya.${d.factory}`,
      code_hashes: {},
      steps: {},
      updated_at: "",
    };
const save = () => {
  record.updated_at = new Date().toISOString();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(record, null, 2)}\n`);
};
const say = (m: string) => console.log(`✔ ${m}`);
const wasm = (name: string) => readFileSync(join(ROOT_DIR, "res", `${name}.wasm`));
const codeHash = (bytes: Uint8Array) => base58Encode(createHash("sha256").update(bytes).digest());

async function step(
  id: string,
  done: () => Promise<boolean>,
  run: () => Promise<string | void>,
): Promise<void> {
  if (await done()) {
    say(`${id} (already done)`);
    return;
  }
  if (verifyOnly) throw new Error(`not done: ${id}`);
  const hash = await run();
  if (hash) record.steps[id] = hash;
  save();
  say(`${id}${hash ? ` — tx ${hash}` : ""}`);
}

async function main() {
  const c: Chain = await chainFor("testnet", RPCS);
  for (const id of [R, KEEPER])
    if (!(await c.hasKey(id))) throw new Error(`no key for ${id} in ~/.near-credentials/testnet`);
  const root = await c.account(R);
  const keeper = await c.account(KEEPER);
  console.log(
    `Runway testnet deployment — root ${R}, RPC ${NODE_URL}${verifyOnly ? " (verify only)" : ""}\n`,
  );

  // 1. accounts
  for (const [k, id] of Object.entries(ACCOUNTS) as [keyof typeof ACCOUNTS, string][]) {
    await step(
      `account ${id}`,
      () => c.exists(id),
      async () => {
        const kp = await c.newKey(id);
        const o = await root.createAccount(id, kp.getPublicKey(), near(FUNDING[k]));
        return (o as { transaction: { hash: string } }).transaction.hash;
      },
    );
  }
  const acc = async (k: keyof typeof ACCOUNTS) => c.account(ACCOUNTS[k]);

  // 2. contracts
  const args = initArgs(profile, { owner: R, token: d.token, credit: d.credit, factory: d.factory });
  // The keeper owns the mock token so the API can mint SIMULATED payments (BUILD_PLAN T2.5).
  const init: Record<string, Record<string, unknown>> = {
    token: { owner: KEEPER },
    factory: args.factory,
    credit: args.credit,
    inr: args.inr,
  };
  for (const k of ["token", "factory", "credit", "inr"] as const) {
    // Without a local build (CI --verify), compare against the hashes recorded at deployment.
    const hash = HAVE_WASM ? codeHash(wasm(WASM[k]!)) : record.code_hashes[ACCOUNTS[k]];
    if (!hash) throw new Error("res/ is missing and deployments/testnet.json has no hash: run make build");
    record.code_hashes[ACCOUNTS[k]] = hash;
    const a = await acc(k);
    await step(
      `deploy ${ACCOUNTS[k]}`,
      async () => {
        const live = (await a.state()).code_hash;
        if (live === hash) return true;
        // Redeploying over existing code only works if the new code reads the old state, so it is opt-in.
        if (live !== EMPTY_CODE && !process.argv.includes("--upgrade"))
          throw new Error(
            `${ACCOUNTS[k]} runs other code (${live}); pass --upgrade to replace it (state must stay compatible)`,
          );
        return false;
      },
      async () =>
        ((await a.deployContract(wasm(WASM[k]!))) as { transaction: { hash: string } }).transaction.hash,
    );
    const viewMethod = k === "token" ? "get_owner" : k === "factory" ? "required_deposit" : "get_config";
    await step(
      `init ${ACCOUNTS[k]}`,
      async () => {
        try {
          await view(a, ACCOUNTS[k], viewMethod);
          return true;
        } catch {
          return false;
        }
      },
      async () => (await call(a, ACCOUNTS[k], "new", init[k]!, { gas: 100n * TGAS })).hash,
    );
  }

  const token = d.token;
  const storageOn = async (contract: string, id: string) =>
    (await view<unknown>(root, contract, "storage_balance_of", { account_id: id })) !== null;
  const balance = async (id: string) =>
    BigInt(await view<string>(root, token, "ft_balance_of", { account_id: id }));

  // 3. token storage, then mint (keeper is the token owner)
  for (const id of [d.credit, d.inr, R, ACCOUNTS.lender, ACCOUNTS.priya, ACCOUNTS.investor, KEEPER]) {
    await step(
      `usdc storage ${id}`,
      () => storageOn(token, id),
      async () =>
        (
          await call(
            root,
            token,
            "storage_deposit",
            { account_id: id, registration_only: true },
            { deposit: near(0.0125), gas: 30n * TGAS },
          )
        ).hash,
    );
  }
  const mints: [string, bigint][] = [
    [ACCOUNTS.lender, usdc(20_000)],
    [R, usdc(100) + profile.gateway.initialFloat],
    [ACCOUNTS.investor, usdc(1_000)],
  ];
  for (const [id, amount] of mints) {
    await step(
      `mint ${id}`,
      async () => record.steps[`mint ${id}`] !== undefined || (await balance(id)) >= amount,
      async () =>
        (await call(keeper, token, "mint", { account_id: id, amount: String(amount) }, { gas: 30n * TGAS }))
          .hash,
    );
  }

  // 4. vault: lender shares, deposit 10,000, reserve 100
  const lender = await acc("lender");
  for (const who of ["lender", "investor"] as const) {
    await step(
      `share storage ${ACCOUNTS[who]}`,
      () => storageOn(d.credit, ACCOUNTS[who]),
      async () =>
        (
          await call(
            await acc(who),
            d.credit,
            "storage_deposit",
            { account_id: ACCOUNTS[who], registration_only: true },
            { deposit: near(0.01), gas: 30n * TGAS },
          )
        ).hash,
    );
  }
  await step(
    "lender deposit 10,000 USDC",
    async () =>
      BigInt(await view<string>(root, d.credit, "ft_balance_of", { account_id: ACCOUNTS.lender })) > 0n,
    async () =>
      (
        await call(
          lender,
          token,
          "ft_transfer_call",
          { receiver_id: d.credit, amount: String(usdc(10_000)), msg: JSON.stringify({ action: "deposit" }) },
          { deposit: 1n, gas: 150n * TGAS },
        )
      ).hash,
  );
  await step(
    "seed reserve 100 USDC",
    async () => BigInt((await view<{ reserve: string }>(root, d.credit, "get_vault")).reserve) > 0n,
    async () =>
      (
        await call(
          root,
          token,
          "ft_transfer_call",
          {
            receiver_id: d.credit,
            amount: String(usdc(100)),
            msg: JSON.stringify({ action: "seed_reserve" }),
          },
          { deposit: 1n, gas: 150n * TGAS },
        )
      ).hash,
  );

  // 5. local-mode agents (Shade local mode: whitelisted accounts, mock measurements; requires_tee = false)
  for (const [contract, role, agentKey] of [
    [d.credit, "Underwriter", "underwriter"],
    [d.inr, "InrGateway", "gateway"],
  ] as const) {
    const agentId = ACCOUNTS[agentKey];
    const approved = () =>
      view<{ measurements: unknown[]; ppids: unknown[]; whitelisted_agents_for_local: string[] }>(
        root,
        contract,
        "get_approved",
      );
    await step(
      `${contract} approve measurements`,
      async () => (await approved()).measurements.length > 0,
      async () =>
        (await call(root, contract, "approve_measurements", { measurements: mockMeasurements() })).hash,
    );
    await step(
      `${contract} approve ppid`,
      async () => (await approved()).ppids.length > 0,
      async () => (await call(root, contract, "approve_ppids", { ppids: [defaultPpid()] })).hash,
    );
    await step(
      `${contract} role ${role}`,
      async () => ((await approved()).measurements as { role: string | null }[]).some((m) => m.role === role),
      async () => (await call(root, contract, "set_role", { measurements: mockMeasurements(), role })).hash,
    );
    await step(
      `${contract} whitelist ${agentId}`,
      async () => (await approved()).whitelisted_agents_for_local.includes(agentId),
      async () => (await call(root, contract, "whitelist_agent_for_local", { account_id: agentId })).hash,
    );
    await step(
      `${contract} register ${agentId}`,
      async () =>
        (await view<{ valid: boolean } | null>(root, contract, "get_agent", { account_id: agentId }))
          ?.valid === true,
      async () =>
        (
          await call(
            await acc(agentKey),
            contract,
            "register_agent",
            { attestation: mockAttestation() },
            { deposit: near(0.01), gas: 100n * TGAS },
          )
        ).hash,
    );
  }

  // 6. INR gateway wiring and float
  await step(
    "credit.set_inr_gateway",
    async () =>
      (await view<{ inr_gateway: string | null }>(root, d.credit, "get_config")).inr_gateway === d.inr,
    async () => (await call(root, d.credit, "set_inr_gateway", { account_id: d.inr })).hash,
  );
  await step(
    `fund float ${Number(profile.gateway.initialFloat / 1_000_000n)} USDC`,
    async () => BigInt((await view<{ free: string }>(root, d.inr, "get_float")).free) > 0n,
    async () =>
      (
        await call(
          root,
          token,
          "ft_transfer_call",
          {
            receiver_id: d.inr,
            amount: String(profile.gateway.initialFloat),
            msg: JSON.stringify({ action: "fund_float" }),
          },
          { deposit: 1n, gas: 150n * TGAS },
        )
      ).hash,
  );

  // 7. the demo merchant
  await step(
    "register merchant priya",
    async () => (await view<unknown>(root, d.credit, "get_merchant", { handle: "priya" })) !== null,
    async () => {
      const deposit = BigInt(await view<string>(root, d.factory, "required_deposit"));
      return (
        await call(
          await acc("priya"),
          d.credit,
          "register_merchant",
          { handle: "priya" },
          { deposit, gas: 300n * TGAS },
        )
      ).hash;
    },
  );

  // 8. checks (also the whole of --verify)
  const settlement = `priya.${d.factory}`;
  const factoryHash = await view<string>(root, d.factory, "get_settlement_code_hash");
  if (HAVE_WASM) record.settlement_code_hash = factoryHash;
  const sAcc = await c.account(settlement);
  const sState = await sAcc.state();
  const keys = await sAcc.getAccessKeys();
  const cfg = await view<{ requires_tee: boolean; time: Record<string, number>; inr_gateway: string }>(
    root,
    d.credit,
    "get_config",
  );
  const limits = await view<Record<string, unknown>>(root, d.inr, "get_limits");
  const expected = HAVE_WASM
    ? readFileSync(join(ROOT_DIR, "res", "CODE_HASHES.txt"), "utf8")
    : // No local build (e.g. CI verify): the hashes recorded at deploy time, in CODE_HASHES.txt's format.
      [
        ...Object.entries(WASM).map(
          ([k, id]) => `${record.code_hashes[ACCOUNTS[k as keyof typeof ACCOUNTS]]}  ${id}.wasm`,
        ),
        `${record.settlement_code_hash ?? ""}  runway_settlement.wasm`,
      ].join("\n");
  const checks: [boolean, string][] = [
    [sState.code_hash === factoryHash, `${settlement} code hash ${sState.code_hash} = factory's`],
    [expected.includes(factoryHash), "factory settlement hash is in res/CODE_HASHES.txt"],
    [keys.length === 0, `${settlement} has ${keys.length} access keys`],
    [cfg.requires_tee === profile.requiresTee, `credit requires_tee = ${cfg.requires_tee} (local mode)`],
    [
      cfg.time.period_sec === profile.time.periodSec &&
        cfg.time.withdraw_cooldown_sec === profile.time.withdrawCooldownSec,
      "credit time profile = testnet",
    ],
    [cfg.inr_gateway === d.inr, "credit.inr_gateway = inr gateway"],
    [limits.spread_bps === profile.gateway.spreadBps, `gateway spread ${String(limits.spread_bps)} bps`],
  ];
  for (const [k, id] of Object.entries(WASM)) {
    const live = (await (await c.account(ACCOUNTS[k as keyof typeof ACCOUNTS])).state()).code_hash;
    checks.push([
      expected.includes(`${live}  ${id}.wasm`),
      `${ACCOUNTS[k as keyof typeof ACCOUNTS]} code ${live} matches res/CODE_HASHES.txt`,
    ]);
  }
  let bad = 0;
  for (const [ok, what] of checks) {
    console.log(`${ok ? "✔" : "✖"} ${what}`);
    if (!ok) bad += 1;
  }

  if (!verifyOnly) {
    const lines = ["# Local-mode agent accounts created by scripts/deploy-testnet.ts. Secret: never commit."];
    for (const [envName, id] of [
      ["UNDERWRITER_AGENT", ACCOUNTS.underwriter],
      ["GATEWAY_AGENT", ACCOUNTS.gateway],
    ] as const) {
      const kp = await c.keyStore.getKey("testnet", id);
      lines.push(`${envName}_ACCOUNT_ID=${id}`, `${envName}_PRIVATE_KEY=${kp.toString()}`);
    }
    writeFileSync(AGENT_ENV, `${lines.join("\n")}\n`, { mode: 0o600 });
    console.log(`\nAgent keys written to .env.agents.local (git-ignored).`);
  }
  save();
  console.log(bad === 0 ? `\nDEPLOYMENT OK — ${OUT}` : `\n${bad} check(s) failed`);
  if (bad) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(`✖ ${(e as Error).message}`);
  process.exit(1);
});
