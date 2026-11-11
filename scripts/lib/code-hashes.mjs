// Prints "<base58 sha256>  <file>" for every .wasm directly inside the given directory.
// base58(sha256(code)) is the format NEAR RPC returns as `code_hash`.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes) {
  let n = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

const dir = process.argv[2];
for (const f of readdirSync(dir)
  .filter((f) => f.endsWith(".wasm"))
  .sort()) {
  const hash = createHash("sha256")
    .update(readFileSync(join(dir, f)))
    .digest();
  console.log(`${base58(hash)}  ${f}`);
}
