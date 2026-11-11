// Local sandbox deployment of the full Runway stack (used by sandbox-demo.ts).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initArgs, profiles, usdc } from "@runway/config";
import { defaultPpid, mockAttestation, mockMeasurements } from "@runway/config/fixtures";
import { Worker, type NearAccount, type TransactionResult } from "near-workspaces";
import { useSandboxBinary } from "./sandbox-binary.js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TGAS = 10n ** 12n;
export const NEAR = 10n ** 24n;
export const ONE_YOCTO = 1n;

export const profile = profiles.sandbox;

const wasm = (name: string) => {
  const p = join(ROOT, "res", `${name}.wasm`);
  try {
    return readFileSync(p);
  } catch {
    throw new Error(`${p} not found. Run: bash scripts/build-contracts.sh`);
  }
};

export interface Stack {
  worker: Worker;
  root: NearAccount;
  owner: NearAccount;
  lender: NearAccount;
  priya: NearAccount;
  solver: NearAccount;
  agent: NearAccount;
  keeper: NearAccount;
  usdc: NearAccount;
  factory: NearAccount;
  credit: NearAccount;
}

export class StepError extends Error {}

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new StepError(message);
}

/** JSON.stringify that prints bigints as decimal strings (used in error messages). */
export function json(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
}

/** Throws with the receipt failure messages unless every receipt succeeded. */
export function ok(r: TransactionResult, what: string): TransactionResult {
  if (r.failed || r.receiptFailureMessages.length > 0) {
    throw new StepError(`${what} failed: ${r.receiptFailureMessages.join(" | ") || r.summary()}`);
  }
  return r;
}

export function events(r: TransactionResult, name: string): Record<string, unknown>[] {
  return r.logs
    .filter((l) => l.startsWith("EVENT_JSON:"))
    .map(
      (l) => JSON.parse(l.slice("EVENT_JSON:".length)) as { event: string; data: Record<string, unknown>[] },
    )
    .filter((e) => e.event === name)
    .map((e) => e.data[0]!);
}

export const fmtUsdc = (micro: bigint | string): string => {
  const v = BigInt(micro);
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${frac}`;
};

export const sha256 = (data: string | Buffer): Buffer => createHash("sha256").update(data).digest();

/**
 * near-workspaces 5 sets NEAR_NO_LOGS, but the near-api-js 5 logger it loads ignores it, so every
 * receipt log and nonce retry is printed. This silences the logger instance near-workspaces actually
 * uses (resolved through its own CommonJS dependency chain), unless NEAR_PRINT_LOGS is set.
 * Failures still surface through `ok()`. Best effort: if resolution fails, the logs stay on.
 */
function quietNearApiLogs(): void {
  if (process.env.NEAR_PRINT_LOGS) return;
  // near-workspaces' own `call()`/`view()` log dump (read on every call).
  process.env.NEAR_WORKSPACES_NO_LOGS = "1";
  try {
    const fromHere = createRequire(import.meta.url);
    const fromWorkspaces = createRequire(fromHere.resolve("near-workspaces"));
    const fromApi = createRequire(fromWorkspaces.resolve("near-api-js"));
    const fromAccounts = createRequire(fromApi.resolve("@near-js/accounts"));
    const { Logger } = fromAccounts("@near-js/utils") as {
      Logger: { overrideLogger(logger: unknown): void };
    };
    const off = () => {};
    Logger.overrideLogger({
      log: off,
      warn: off,
      debug: off,
      verbose: off,
      error: console.error,
      fatal: console.error,
    });
  } catch {
    // keep the default logs
  }
}

export async function deployStack(): Promise<Stack> {
  await useSandboxBinary();
  quietNearApiLogs();
  const worker = await Worker.init();
  const root = worker.rootAccount;
  const sub = (name: string, near: bigint) => root.createSubAccount(name, { initialBalance: near * NEAR });
  const [owner, lender, priya, solver, agent, keeper] = await Promise.all([
    sub("owner", 100n),
    sub("lender", 50n),
    sub("priya", 50n),
    sub("solver", 50n),
    sub("agent", 20n),
    sub("keeper", 50n),
  ]);
  const [usdcAcc, factory, credit] = await Promise.all([
    sub("usdc", 20n),
    sub("pay", 30n),
    sub("credit", 50n),
  ]);
  await usdcAcc.deploy(wasm("runway_mock_usdc"));
  await factory.deploy(wasm("runway_factory"));
  await credit.deploy(wasm("runway_credit"));

  const args = initArgs(profile, {
    owner: owner.accountId,
    token: usdcAcc.accountId,
    credit: credit.accountId,
    factory: factory.accountId,
  });
  ok(await usdcAcc.callRaw(usdcAcc, "new", args.usdc), "usdc.new");
  ok(await factory.callRaw(factory, "new", args.factory), "factory.new");
  ok(await credit.callRaw(credit, "new", args.credit), "credit.new");

  const s: Stack = {
    worker,
    root,
    owner,
    lender,
    priya,
    solver,
    agent,
    keeper,
    usdc: usdcAcc,
    factory,
    credit,
  };
  for (const a of [credit, owner, lender, priya, solver]) await registerUsdc(s, a.accountId);
  await mint(s, lender.accountId, usdc(20_000));
  await mint(s, solver.accountId, usdc(1_000_000));
  await mint(s, owner.accountId, usdc(1_000));
  ok(
    await lender.callRaw(
      credit,
      "storage_deposit",
      { account_id: lender.accountId, registration_only: true },
      { attachedDeposit: NEAR / 100n },
    ),
    "shares storage",
  );
  return s;
}

export async function registerUsdc(s: Stack, accountId: string): Promise<void> {
  ok(
    await s.owner.callRaw(
      s.usdc,
      "storage_deposit",
      { account_id: accountId, registration_only: true },
      { attachedDeposit: NEAR / 100n },
    ),
    `usdc storage for ${accountId}`,
  );
}

export async function mint(s: Stack, to: string, micro: bigint): Promise<void> {
  ok(await s.owner.callRaw(s.usdc, "mint", { account_id: to, amount: String(micro) }), "mint");
}

export async function balance(s: Stack, accountId: string): Promise<bigint> {
  return BigInt(await s.usdc.view<string>("ft_balance_of", { account_id: accountId }));
}

/** Owner approves the local-mode mock measurements, assigns the Underwriter role, whitelists and registers the agent. */
export async function setupLocalAgent(s: Stack): Promise<void> {
  const c = s.credit;
  ok(
    await s.owner.callRaw(c, "approve_measurements", { measurements: mockMeasurements() }),
    "approve_measurements",
  );
  ok(await s.owner.callRaw(c, "approve_ppids", { ppids: [defaultPpid()] }), "approve_ppids");
  ok(
    await s.owner.callRaw(c, "set_role", { measurements: mockMeasurements(), role: "Underwriter" }),
    "set_role",
  );
  ok(await s.owner.callRaw(c, "whitelist_agent_for_local", { account_id: s.agent.accountId }), "whitelist");
  ok(
    await s.agent.callRaw(
      c,
      "register_agent",
      { attestation: mockAttestation() },
      { attachedDeposit: NEAR / 100n, gas: 100n * TGAS },
    ),
    "register_agent",
  );
}

export async function deliver(s: Stack, settlement: string, micro: bigint): Promise<void> {
  ok(
    await s.solver.callRaw(
      s.usdc,
      "ft_transfer",
      { receiver_id: settlement, amount: String(micro) },
      { attachedDeposit: ONE_YOCTO },
    ),
    "deliver",
  );
}

export async function settle(s: Stack, settlement: string): Promise<TransactionResult> {
  return ok(await s.keeper.callRaw(settlement, "settle", {}, { gas: 250n * TGAS }), "settle");
}

export async function currentBucket(s: Stack, settlement: string): Promise<bigint> {
  const st = await s.root.getAccount(settlement).view<{ current_bucket: string }>("get_state");
  return BigInt(st.current_bucket);
}

/**
 * Fast-forwards to the start of bucket `target` (measured from the settlement's own `bucket_sec`),
 * so the deliveries and settles that follow land inside that bucket. Fails loudly if the bucket was
 * already passed or skipped, instead of letting two deliveries merge into one bucket.
 */
export async function advanceToBucket(s: Stack, settlement: string, target: bigint): Promise<void> {
  const st = await s.root.getAccount(settlement).view<{ bucket_sec: string }>("get_state");
  await advanceToSec(s, Number(target * BigInt(st.bucket_sec)));
  const now = await currentBucket(s, settlement);
  check(now === target, `expected to be in bucket ${target}, chain is in bucket ${now}`);
}

interface BlockView {
  header: { height: number; timestamp_nanosec: string };
}

/**
 * Latest optimistic block. On the sandbox the final head stops moving during fast-forward (it
 * catches up on the next transaction), so chain time is read from the optimistic head; receipts
 * always execute in a block at or after it. The provider extends near-api-js's JsonRpcProvider
 * (which has `block`) but the re-exported type omits it, hence the narrow interface and fallback.
 */
export async function latestBlock(s: Stack): Promise<BlockView> {
  const p = s.worker.provider as unknown as {
    block?: (q: { finality: string }) => Promise<BlockView>;
    sendJsonRpc: (method: string, params: unknown) => Promise<BlockView>;
  };
  const q = { finality: "optimistic" };
  return p.block ? p.block(q) : p.sendJsonRpc("block", q);
}

export async function nowSec(s: Stack): Promise<number> {
  const b = await latestBlock(s);
  return Math.floor(Number(BigInt(b.header.timestamp_nanosec) / 1_000_000_000n));
}

/** Chain time added per fast-forwarded block on the nearcore 2.14 sandbox (measured: ~1.35 s). */
const FF_SEC_PER_BLOCK = 1.35;

/** Fast-forwards until chain time reaches `targetSec`: one jump sized from the measured block time,
 *  then small top-ups if it fell short. */
export async function advanceToSec(s: Stack, targetSec: number): Promise<void> {
  for (;;) {
    const gap = targetSec - (await nowSec(s));
    if (gap <= 0) return;
    await s.worker.provider.fastForward(Math.max(1, Math.ceil(gap / FF_SEC_PER_BLOCK)));
  }
}

export async function advanceSecs(s: Stack, secs: number): Promise<void> {
  await advanceToSec(s, (await nowSec(s)) + secs);
}

/** T4b.10 step 14: deploy inr-gateway, point credit at it, register a local InrGateway agent and fund 1,000 USDC. */
export async function deployInrGateway(s: Stack): Promise<{ inr: NearAccount; gwagent: NearAccount }> {
  const [inr, gwagent] = await Promise.all([
    s.root.createSubAccount("inr", { initialBalance: 20n * NEAR }),
    s.root.createSubAccount("gwagent", { initialBalance: 20n * NEAR }),
  ]);
  await inr.deploy(wasm("runway_inr_gateway"));
  const args = initArgs(profile, {
    owner: s.owner.accountId,
    token: s.usdc.accountId,
    credit: s.credit.accountId,
    factory: s.factory.accountId,
  });
  ok(await inr.callRaw(inr, "new", args.inr), "inr.new");
  await registerUsdc(s, inr.accountId);
  ok(
    await s.owner.callRaw(inr, "approve_measurements", { measurements: mockMeasurements() }),
    "inr.approve_measurements",
  );
  ok(await s.owner.callRaw(inr, "approve_ppids", { ppids: [defaultPpid()] }), "inr.approve_ppids");
  ok(
    await s.owner.callRaw(inr, "set_role", { measurements: mockMeasurements(), role: "InrGateway" }),
    "inr.set_role",
  );
  ok(
    await s.owner.callRaw(inr, "whitelist_agent_for_local", { account_id: gwagent.accountId }),
    "inr.whitelist",
  );
  ok(
    await gwagent.callRaw(
      inr,
      "register_agent",
      { attestation: mockAttestation() },
      { attachedDeposit: NEAR / 100n, gas: 100n * TGAS },
    ),
    "inr.register_agent",
  );
  ok(
    await s.owner.callRaw(s.credit, "set_inr_gateway", { account_id: inr.accountId }),
    "credit.set_inr_gateway",
  );
  await mint(s, s.owner.accountId, profile.gateway.initialFloat);
  ok(
    await s.owner.callRaw(
      s.usdc,
      "ft_transfer_call",
      {
        receiver_id: inr.accountId,
        amount: String(profile.gateway.initialFloat),
        msg: JSON.stringify({ action: "fund_float" }),
      },
      { attachedDeposit: ONE_YOCTO, gas: 150n * TGAS },
    ),
    "fund float",
  );
  return { inr, gwagent };
}
