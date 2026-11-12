// Creates a testnet account to test the web app with: funded from the root, registered with mock USDC,
// and given mock USDC (the keeper owns the mock token). Its key is saved to near CLI's legacy keychain
// (~/.near-credentials/testnet/<account>.json), from where it can be imported into a wallet.
//   pnpm --filter @runway/scripts make-tester [name] [--near 4] [--usdc 1000]
import { deploymentFor, usdc } from "@runway/config";
import { call, chainFor, near, TGAS, view } from "./lib/near.js";

const R = process.env.RUNWAY_ROOT ?? "runway-rama.testnet";
const KEEPER = process.env.KEEPER_ACCOUNT_ID ?? `keeper.${R}`;
const name = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "tester";
const opt = (k: string, d: number) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? Number(process.argv[i + 1]) : d;
};
const id = `${name}.${R}`;
const d = deploymentFor(R);

async function main() {
  const c = await chainFor("testnet", process.env.NEAR_RPC_URL ?? "https://rpc.testnet.fastnear.com");
  const root = await c.account(R);
  if (!(await c.exists(id))) {
    const kp = await c.newKey(id);
    await root.createAccount(id, kp.getPublicKey(), near(opt("near", 4)));
    console.log(`✔ created ${id} with ${opt("near", 4)} NEAR`);
  } else console.log(`✔ ${id} exists`);
  if ((await view(root, d.token, "storage_balance_of", { account_id: id })) === null) {
    await call(root, d.token, "storage_deposit", { account_id: id, registration_only: true }, { deposit: near(0.0125), gas: 30n * TGAS });
    console.log("✔ registered with mock USDC");
  }
  const amount = usdc(opt("usdc", 1_000));
  const r = await call(await c.account(KEEPER), d.token, "mint", { account_id: id, amount: String(amount) }, { gas: 30n * TGAS });
  console.log(`✔ minted ${opt("usdc", 1_000)} mock USDC (tx ${r.hash})`);
  console.log(`\nKey file (import its private_key into a testnet wallet): ~/.near-credentials/testnet/${id}.json`);
}

main().catch((e: unknown) => {
  console.error(`✖ ${(e as Error).message}`);
  process.exit(1);
});
