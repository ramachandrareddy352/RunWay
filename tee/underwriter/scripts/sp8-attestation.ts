// Spike SP8 (BUILD_PLAN T4.0): verify a live NEAR AI Cloud attestation report in Node with
// @phala/dcap-qvl and this package's checks. The report endpoint is public for public models: no
// API key and no credits are used. Usage: pnpm --filter @runway/underwriter exec tsx scripts/sp8-attestation.ts [model]
import { randomBytes, toHex } from "@runway/sdk";
import { dcapQuoteVerifier, nrasCheck, verifyAttestation } from "../src/nearai.js";

const model = process.argv[2] ?? "z-ai/glm-5.3-flash";
const nonce = toHex(randomBytes(32));
const q = new URLSearchParams({ model, provider: "near", signing_algo: "ecdsa", nonce });
const res = await fetch(`https://cloud-api.near.ai/v1/attestation/report?${q}`, {
  headers: { accept: "application/json", "x-no-aliasing": "true" },
});
console.log(`report: HTTP ${res.status}`);
if (!res.ok) {
  console.log((await res.text()).slice(0, 500));
  process.exit(1);
}
const report = (await res.json()) as { gateway_attestation?: unknown; model_attestations?: unknown[] };
console.log(
  `keys: ${Object.keys(report).join(", ")}; model attestations: ${report.model_attestations?.length ?? 0}`,
);
// Default policy: UpToDate only. SP8_TCB=UpToDate,SWHardeningNeeded widens it for the spike.
const acceptedTcb = (process.env.SP8_TCB ?? "UpToDate").split(",");
const deps = { quotes: dcapQuoteVerifier(), nvidia: nrasCheck(), acceptedTcb };
const run = async (label: string, a: unknown) => {
  const started = Date.now();
  try {
    const s = await verifyAttestation(a as Parameters<typeof verifyAttestation>[0], nonce, deps);
    console.log(`${label}: VERIFIED signer ${s.address} (${Date.now() - started} ms)`);
  } catch (e) {
    console.log(`${label}: REJECTED — ${(e as Error).message} (${Date.now() - started} ms)`);
  }
};
await run("gateway", report.gateway_attestation);
for (const [i, m] of (report.model_attestations ?? []).entries()) await run(`model[${i}]`, m);
