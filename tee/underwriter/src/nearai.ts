// NEAR AI Cloud private inference, verified end to end (design §8.5, BUILD_PLAN T4.2/T4.3).
// Formats follow docs.near.ai/cloud/verification (read 2026-11-11):
//   GET /v1/attestation/report?model&provider=near&signing_algo=ecdsa&nonce  (x-no-aliasing: true)
//     → gateway_attestation + model_attestations[], each with intel_quote, event_log, request_nonce,
//       signing_address, signing_algo, info.tcb_info.app_compose and optionally nvidia_payload
//   report_data = signing identity (20-byte address, zero-padded to 32) ‖ 32-byte client nonce
//   RTMR3 = fold SHA-384 over imr==3 events; MRCONFIGID = 0x01 ‖ sha256(app_compose) ‖ 15 zero bytes
//   GET /v1/signature/<chat_id>?signing_algo=ecdsa → provider_tee text "<model>:<req_sha256>:<res_sha256>"
//     signed with EIP-191 by the model's signing address.
// Any failure drops the statement evidence (fail closed for evidence, never for the offer).
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256, sha384 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  base58Encode,
  concatBytes,
  equalBytes,
  fromHex,
  fromUtf8,
  randomBytes,
  toHex,
  utf8,
} from "@runway/sdk";
import { z } from "zod";

// ---------- quote verification (SP8) ----------

export interface VerifiedQuote {
  status: string;
  reportData: Uint8Array;
  rtmr3: Uint8Array;
  mrConfigId: Uint8Array;
  tdAttributes: Uint8Array;
}

export interface QuoteVerifier {
  verify(quote: Uint8Array): Promise<VerifiedQuote>;
}

interface TdReportLike {
  reportData: Uint8Array;
  rtMr3: Uint8Array;
  mrConfigId: Uint8Array;
  tdAttributes: Uint8Array;
}
interface DcapModule {
  getCollateralAndVerify(
    quote: Uint8Array,
    pccsUrl?: string,
  ): Promise<{
    status: string;
    report: { asTd10(): TdReportLike | null; asTd15(): { base: TdReportLike } | null };
  }>;
}

/** Intel DCAP verification with `@phala/dcap-qvl` (collateral from Phala's PCCS by default). */
export function dcapQuoteVerifier(pccsUrl?: string): QuoteVerifier {
  return {
    async verify(quote) {
      const imported = (await import("@phala/dcap-qvl")) as unknown as DcapModule & { default?: DcapModule };
      const m = typeof imported.getCollateralAndVerify === "function" ? imported : imported.default!;
      const v = await m.getCollateralAndVerify(quote, pccsUrl);
      const td = v.report.asTd10() ?? v.report.asTd15()?.base;
      if (!td) throw new Error("not a TDX quote");
      return {
        status: v.status,
        reportData: td.reportData,
        rtmr3: td.rtMr3,
        mrConfigId: td.mrConfigId,
        tdAttributes: td.tdAttributes,
      };
    },
  };
}

// ---------- attestation report ----------

const Attestation = z.object({
  intel_quote: z.string().regex(/^(0x)?[0-9a-fA-F]+$/),
  event_log: z.union([z.string(), z.array(z.unknown())]),
  request_nonce: z.string(),
  signing_address: z.string(),
  signing_algo: z.string(),
  nvidia_payload: z.string().optional().nullable(),
  info: z.object({ tcb_info: z.union([z.string(), z.record(z.string(), z.unknown())]) }).passthrough(),
});
type Attestation = z.infer<typeof Attestation>;

const Report = z.object({
  gateway_attestation: Attestation,
  model_attestations: z.array(Attestation).optional(),
});

const Event = z.object({
  imr: z.number().int(),
  event_type: z.number().int(),
  digest: z.string().optional().nullable(),
  event: z.string(),
  event_payload: z.string(),
});

export interface Signer {
  algo: string;
  /** Lowercase 0x-hex address (ecdsa). */
  address: string;
}

export class EvidenceRejected extends Error {}
function reject(msg: string): never {
  throw new EvidenceRejected(msg);
}

const strip0x = (h: string) => (h.startsWith("0x") || h.startsWith("0X") ? h.slice(2) : h);

/** RTMR3 replay over the imr==3 events (docs: digest = SHA-384(type_le32 ‖ ":" ‖ event ‖ ":" ‖ payload)). */
export function replayRtmr3(eventLog: unknown): Uint8Array {
  const events = z.array(Event).parse(typeof eventLog === "string" ? JSON.parse(eventLog) : eventLog);
  let rtmr = new Uint8Array(48);
  for (const e of events) {
    if (e.imr !== 3) continue;
    const type = new Uint8Array(4);
    new DataView(type.buffer).setUint32(0, e.event_type, true);
    const digest = sha384(concatBytes(type, utf8(":"), utf8(e.event), utf8(":"), fromHex(e.event_payload)));
    if (e.digest && strip0x(e.digest).toLowerCase() !== toHex(digest)) reject("event log digest mismatch");
    rtmr = sha384(concatBytes(rtmr, digest));
  }
  return rtmr;
}

/** MRCONFIGID = 0x01 ‖ sha256(app_compose as measured, unparsed) ‖ 15 zero bytes. */
export function expectedMrConfigId(appCompose: string): Uint8Array {
  return concatBytes(Uint8Array.of(1), sha256(utf8(appCompose)), new Uint8Array(15));
}

function appComposeOf(a: Attestation): string {
  const tcb =
    typeof a.info.tcb_info === "string" ? (JSON.parse(a.info.tcb_info) as unknown) : a.info.tcb_info;
  const compose = (tcb as { app_compose?: unknown }).app_compose;
  if (typeof compose !== "string") reject("tcb_info has no app_compose");
  return compose as string;
}

export interface NvidiaCheck {
  /** POSTs the decoded payload to NVIDIA NRAS and returns the response JSON. */
  attest(payload: unknown): Promise<unknown>;
}

export const nrasCheck = (f: typeof fetch = fetch): NvidiaCheck => ({
  async attest(payload) {
    const res = await f("https://nras.attestation.nvidia.com/v3/attest/gpu", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`NRAS HTTP ${res.status}`);
    return res.json();
  },
});

function jwtPayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  if (!part) reject("malformed NVIDIA token");
  const b64 = part!.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(fromUtf8(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))) as Record<string, unknown>;
}

export interface VerifyDeps {
  quotes: QuoteVerifier;
  nvidia: NvidiaCheck;
  acceptedTcb?: string[];
}

/** One report (gateway or model): quote, debug bit, report_data, nonce, RTMR3, MRCONFIGID, GPU. */
export async function verifyAttestation(a: Attestation, nonceHex: string, d: VerifyDeps): Promise<Signer> {
  if (a.signing_algo !== "ecdsa") reject(`unsupported signing_algo ${a.signing_algo}`);
  if (a.request_nonce.toLowerCase() !== nonceHex) reject("request_nonce does not echo our nonce");
  const q = await d.quotes.verify(fromHex(a.intel_quote));
  if (!(d.acceptedTcb ?? ["UpToDate"]).includes(q.status)) reject(`TCB status ${q.status}`);
  if (((q.tdAttributes[0] ?? 0) & 1) !== 0) reject("TD debug mode enabled");
  const address = fromHex(a.signing_address);
  if (address.length !== 20) reject("ecdsa signing_address must be 20 bytes");
  const expected = concatBytes(address, new Uint8Array(12), fromHex(nonceHex));
  if (!equalBytes(q.reportData.slice(0, 64), expected))
    reject("report_data does not bind the signer and nonce");
  if (!equalBytes(replayRtmr3(a.event_log), q.rtmr3)) reject("RTMR3 replay mismatch");
  if (!equalBytes(q.mrConfigId.slice(0, 48), expectedMrConfigId(appComposeOf(a))))
    reject("MRCONFIGID does not match app_compose");
  if (a.nvidia_payload) {
    const payload = JSON.parse(a.nvidia_payload) as { nonce?: string };
    if ((payload.nonce ?? "").toLowerCase() !== nonceHex) reject("NVIDIA payload nonce mismatch");
    const r = (await d.nvidia.attest(payload)) as unknown[];
    const first = Array.isArray(r) ? (r[0] as unknown[]) : undefined;
    if (!first || first[0] !== "JWT" || typeof first[1] !== "string") reject("unexpected NRAS response");
    if (jwtPayload(first![1] as string)["x-nvidia-overall-att-result"] !== true)
      reject("GPU attestation failed");
  }
  return { algo: a.signing_algo, address: `0x${toHex(address)}` };
}

// ---------- signatures ----------

/** EIP-191 personal_sign recovery: the 0x address that signed `text` (65-byte r‖s‖v signature). */
export function recoverEip191(text: string, signatureHex: string): string {
  const msg = utf8(text);
  const hash = keccak_256(concatBytes(utf8(`\x19Ethereum Signed Message:\n${msg.length}`), msg));
  const sig = fromHex(signatureHex);
  if (sig.length !== 65) reject("signature must be 65 bytes");
  let v = sig[64]!;
  if (v >= 27) v -= 27;
  if (v > 1) reject("bad recovery id");
  const pub = secp256k1.Signature.fromBytes(sig.slice(0, 64), "compact")
    .addRecoveryBit(v)
    .recoverPublicKey(hash)
    .toBytes(false);
  return `0x${toHex(keccak_256(pub.slice(1)).slice(-20))}`;
}

const SignatureResponse = z.object({
  text: z.string(),
  signature: z.string(),
  signing_address: z.string(),
  signing_algo: z.string(),
  signature_kind: z.string().optional(),
});
export type SignatureResponse = z.infer<typeof SignatureResponse>;

/** E13/E14: provider_tee only, exact text, the recovered signer is a verified MODEL signer. */
export function checkChatSignature(
  s: SignatureResponse,
  model: string,
  requestBytes: Uint8Array,
  responseBytes: Uint8Array,
  modelSigners: Signer[],
): void {
  if (s.signature_kind !== "provider_tee")
    reject(`signature kind ${s.signature_kind ?? "missing"} is not provider_tee`);
  const expected = `${model}:${toHex(sha256(requestBytes))}:${toHex(sha256(responseBytes))}`;
  if (s.text !== expected) reject("signed text does not match the exact request/response bytes or model");
  const signer = recoverEip191(s.text, s.signature);
  if (signer !== s.signing_address.toLowerCase()) reject("recovered signer differs from signing_address");
  if (!modelSigners.some((m) => m.algo === s.signing_algo && m.address === signer))
    reject("signer is not a verified model attestation");
}

// ---------- client ----------

// Canonical ids (x-no-aliasing): the docs example "zai-org/GLM-5.1-FP8" is an alias of z-ai/glm-5.3-flash (SP8).
export const STATEMENT_MODELS = ["z-ai/glm-5.3-flash"] as const;
const ATTESTATION_TTL_MS = 10 * 60_000;

export const Extraction = z
  .array(
    z.object({
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      currency: z.literal("USD"),
      incoming_total: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/),
    }),
  )
  .min(1)
  .max(36);
export type Extraction = z.infer<typeof Extraction>;

export interface StatementEvidence {
  model: string;
  chatId: string;
  months: Extraction;
  /** Median monthly incoming total, micro-USDC. */
  medianMonthly: bigint;
  /** base58 sha256(model|chat_id|request_hash|response_hash|signature). */
  receiptHash: string;
}

export interface NearAiOptions {
  base: string;
  apiKey: string;
  model: (typeof STATEMENT_MODELS)[number];
  verify: VerifyDeps;
  dailyCalls: number;
  fetch?: typeof fetch;
  now?: () => number;
}

const SYSTEM_PROMPT =
  "You extract monthly incoming totals from a bank or payment statement. Reply with JSON only: an array " +
  'of {"month":"YYYY-MM","currency":"USD","incoming_total":"<decimal string>"}, one entry per month, ' +
  "counting only money received. No prose.";

export class NearAi {
  private cache?: { at: number; signers: Signer[] };
  private day = "";
  private calls = 0;

  constructor(private readonly o: NearAiOptions) {
    if (!STATEMENT_MODELS.includes(o.model)) throw new Error(`model ${o.model} is not on the allowlist`);
  }

  private get f() {
    return this.o.fetch ?? fetch;
  }
  private now() {
    return (this.o.now ?? Date.now)();
  }

  /** Verified model signers, re-verified with a fresh nonce after 10 minutes. */
  async modelSigners(): Promise<Signer[]> {
    if (this.cache && this.now() - this.cache.at < ATTESTATION_TTL_MS) return this.cache.signers;
    const nonce = toHex(randomBytes(32));
    const q = new URLSearchParams({ model: this.o.model, provider: "near", signing_algo: "ecdsa", nonce });
    const res = await this.f(`${this.o.base}/v1/attestation/report?${q}`, {
      headers: {
        accept: "application/json",
        "x-no-aliasing": "true",
        authorization: `Bearer ${this.o.apiKey}`,
      },
    });
    if (!res.ok) reject(`attestation report HTTP ${res.status}`);
    const report = Report.parse(await res.json());
    await verifyAttestation(report.gateway_attestation, nonce, this.o.verify);
    const models = report.model_attestations ?? [];
    if (models.length === 0) reject("no model attestation: gateway-only evidence is not accepted");
    const signers: Signer[] = [];
    for (const m of models) signers.push(await verifyAttestation(m, nonce, this.o.verify));
    this.cache = { at: this.now(), signers };
    return signers;
  }

  private takeCall(): void {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.calls = 0;
    }
    if (this.calls >= this.o.dailyCalls) reject("NEAR AI daily call cap reached");
    this.calls += 1;
  }

  private async chat(
    text: string,
  ): Promise<{ id: string; content: string; req: Uint8Array; res: Uint8Array }> {
    this.takeCall();
    const req = utf8(
      JSON.stringify({
        model: this.o.model,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
      }),
    );
    const r = await this.f(`${this.o.base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.o.apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
        "accept-encoding": "identity",
        "x-no-aliasing": "true",
      },
      body: req,
    });
    const res = new Uint8Array(await r.arrayBuffer());
    if (!r.ok) reject(`chat HTTP ${r.status}`);
    const body = z
      .object({
        id: z.string().min(1),
        choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
      })
      .parse(JSON.parse(fromUtf8(res)));
    return { id: body.id, content: body.choices[0]!.message.content, req, res };
  }

  private async signature(chatId: string): Promise<SignatureResponse> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await this.f(`${this.o.base}/v1/signature/${encodeURIComponent(chatId)}?signing_algo=ecdsa`, {
        headers: { accept: "application/json", authorization: `Bearer ${this.o.apiKey}` },
      });
      if (r.status === 404) {
        await new Promise((ok) => setTimeout(ok, 500 * (attempt + 1)));
        continue;
      }
      if (!r.ok) reject(`signature HTTP ${r.status}`);
      const body = (await r.json()) as Record<string, unknown>;
      if ("error_code" in body) reject("signature unavailable");
      return SignatureResponse.parse(body);
    }
    return reject("signature not found");
  }

  /** E15: JSON that fails validation twice drops the source. */
  async extract(statementText: string): Promise<StatementEvidence> {
    const signers = await this.modelSigners();
    for (let attempt = 0; attempt < 2; attempt++) {
      const c = await this.chat(statementText);
      let months: Extraction;
      try {
        months = Extraction.parse(JSON.parse(stripFences(c.content)));
      } catch {
        continue;
      }
      const sig = await this.signature(c.id);
      checkChatSignature(sig, this.o.model, c.req, c.res, signers);
      const reqHash = toHex(sha256(c.req));
      const resHash = toHex(sha256(c.res));
      return {
        model: this.o.model,
        chatId: c.id,
        months,
        medianMonthly: medianMonthly(months),
        receiptHash: base58Encode(
          sha256(utf8(`${this.o.model}|${c.id}|${reqHash}|${resHash}|${sig.signature}`)),
        ),
      };
    }
    return reject("statement extraction returned invalid JSON twice");
  }
}

const stripFences = (s: string) =>
  s
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

function medianMonthly(m: Extraction): bigint {
  const v = m
    .map((x) => {
      const [w, f = ""] = x.incoming_total.split(".");
      return BigInt(w!) * 1_000_000n + BigInt(f.padEnd(6, "0"));
    })
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2n;
}
