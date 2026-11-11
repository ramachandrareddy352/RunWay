// Prints a contract's init JSON from @runway/config (runbook §8.2/§8.5), so profiles have one source
// of truth.   pnpm -s --filter @runway/scripts print-init <usdc|factory|credit|inr> <testnet|sandbox> <root>
import { deploymentFor, initArgs, profiles, type Network } from "@runway/config";

const [contract, network, root] = process.argv.slice(2);
if (
  !contract ||
  !network ||
  !root ||
  !["usdc", "factory", "credit", "inr"].includes(contract) ||
  !(network in profiles)
) {
  console.error("usage: print-init <usdc|factory|credit|inr> <testnet|sandbox> <root>");
  process.exit(1);
}
if (network === "mainnet") {
  console.error("mainnet is not deployed (Amendment A1: testnet only)");
  process.exit(1);
}
const d = deploymentFor(root);
const args = initArgs(profiles[network as Network], {
  owner: root,
  token: d.token,
  credit: d.credit,
  factory: d.factory,
});
console.log(JSON.stringify(args[contract as keyof typeof args]));
