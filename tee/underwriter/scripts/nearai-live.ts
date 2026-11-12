// Live check of statement extraction on NEAR AI Cloud: attestation (gateway + model) → one chat call →
// signature fetched and verified against the model signer → receipt hash. Uses one chat completion.
//   pnpm --filter @runway/underwriter exec tsx --env-file=../../.env scripts/nearai-live.ts
import { dcapQuoteVerifier, NearAi, nrasCheck } from "../src/nearai.js";

const apiKey = process.env.NEARAI_API_KEY;
if (!apiKey) throw new Error("NEARAI_API_KEY is not set");
const ai = new NearAi({
  base: "https://cloud-api.near.ai",
  apiKey,
  model: "z-ai/glm-5.3-flash",
  verify: { quotes: dcapQuoteVerifier(), nvidia: nrasCheck() },
  dailyCalls: 2,
});
const statement = [
  "Statement for Example Studio, USD account",
  "2026-06-03 | Incoming wire, client A | 2,100.00",
  "2026-06-19 | Incoming wire, client B | 1,800.00",
  "2026-07-08 | Incoming wire, client A | 4,000.00",
  "2026-08-12 | Incoming wire, client C | 4,200.00",
  "2026-08-20 | Card payment, software | -49.00",
].join("\n");
const started = Date.now();
try {
  const r = await ai.extract(statement);
  console.log(`✔ verified private inference in ${Date.now() - started} ms`);
  console.log(`  model ${r.model}, chat ${r.chatId}`);
  console.log(`  months ${JSON.stringify(r.months)}`);
  console.log(`  median monthly ${r.medianMonthly} µUSD, receipt ${r.receiptHash}`);
} catch (e) {
  console.log(`✖ ${(e as Error).message}`);
  process.exit(1);
}
