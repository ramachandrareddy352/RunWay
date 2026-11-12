// CI only: writes near CLI's legacy keychain (~/.near-credentials/testnet/<account>.json) from the
// TESTNET_KEYS_JSON secret, a JSON object {"<account id>": "ed25519:<private key>", ...}, so the deploy,
// E2E and pin scripts run unchanged in GitHub Actions. Prints account ids only, never keys.
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { KeyPair } from "near-api-js";

type KeyPairString = Parameters<typeof KeyPair.fromString>[0];

const raw = process.env.TESTNET_KEYS_JSON;
if (!raw) {
  console.error("TESTNET_KEYS_JSON is not set");
  process.exit(1);
}
let keys: Record<string, string>;
try {
  keys = JSON.parse(raw) as Record<string, string>;
} catch {
  console.error("TESTNET_KEYS_JSON is not valid JSON");
  process.exit(1);
}
const dir = join(homedir(), ".near-credentials", "testnet");
mkdirSync(dir, { recursive: true });
for (const [account_id, private_key] of Object.entries(keys)) {
  const kp = KeyPair.fromString(private_key as KeyPairString);
  writeFileSync(
    join(dir, `${account_id}.json`),
    JSON.stringify({ account_id, public_key: kp.getPublicKey().toString(), private_key }),
    { mode: 0o600 },
  );
  console.log(`keychain: ${account_id}`);
}
