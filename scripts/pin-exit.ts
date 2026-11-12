// T5.6: pin apps/exit/dist/exit.html to public IPFS through Pinata and record the CID on-chain with
// credit.set_exit_app_cid (owner = the testnet root).
//   pnpm --filter @runway/exit build && pnpm --filter @runway/scripts pin-exit [--no-chain]
// Pinata v3 upload: POST https://uploads.pinata.cloud/v3/files, Bearer JWT, form fields file + network=public;
// the CID is data.cid (docs.pinata.cloud, read 2026-11-12).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deploymentFor } from "@runway/config";
import { call, chainFor, view } from "./lib/near.js";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = join(ROOT_DIR, "apps", "exit", "dist", "exit.html");
const OUT = join(ROOT_DIR, "deployments", "testnet.json");
const R = process.env.RUNWAY_ROOT ?? "runway-rama.testnet";

async function main() {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error("PINATA_JWT is not set (.env)");
  if (!existsSync(HTML)) throw new Error(`${HTML} not found: run pnpm --filter @runway/exit build`);

  const auth = await fetch("https://api.pinata.cloud/data/testAuthentication", {
    headers: { authorization: `Bearer ${jwt}`, accept: "application/json" },
  });
  if (!auth.ok) throw new Error(`Pinata authentication failed: HTTP ${auth.status}`);
  console.log("✔ Pinata JWT accepted");

  const html = readFileSync(HTML);
  const form = new FormData();
  form.append("file", new File([html], "exit.html", { type: "text/html" }));
  form.append("network", "public");
  form.append("name", "runway-exit.html");
  const res = await fetch("https://uploads.pinata.cloud/v3/files", {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}` },
    body: form,
  });
  const body = (await res.json()) as { data?: { cid?: string }; error?: unknown };
  if (!res.ok || !body.data?.cid)
    throw new Error(`Pinata upload failed: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  const cid = body.data.cid;
  console.log(`✔ pinned exit.html (${html.length} bytes) → CID ${cid}`);
  for (const g of [`https://ipfs.io/ipfs/${cid}`, `https://${cid}.ipfs.dweb.link`]) console.log(`  ${g}`);

  if (existsSync(OUT)) {
    const rec = JSON.parse(readFileSync(OUT, "utf8")) as Record<string, unknown>;
    rec.exit_cid = cid;
    writeFileSync(OUT, `${JSON.stringify(rec, null, 2)}\n`);
  }
  if (process.argv.includes("--no-chain")) return;
  const d = deploymentFor(R);
  const c = await chainFor("testnet", process.env.NEAR_RPC_URL ?? "https://rpc.testnet.fastnear.com");
  const root = await c.account(R);
  if ((await view<string | null>(root, d.credit, "get_exit_app_cid")) === cid) {
    console.log("✔ credit.get_exit_app_cid already set");
    return;
  }
  const r = await call(root, d.credit, "set_exit_app_cid", { cid });
  console.log(`✔ credit.set_exit_app_cid("${cid}") — tx ${r.hash}`);
}

main().catch((e: unknown) => {
  console.error(`✖ ${(e as Error).message}`);
  process.exit(1);
});
