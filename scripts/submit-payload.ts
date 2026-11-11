// T6.5: build, validate and (only after the human types "yes") send the hackathon submission.
// Rules from hackathon.md "Submission API": exactly these fields, requestId generated once and reused
// on retries, never submitted twice. The input file and the request id are git-ignored (.gitignore:
// payload*.json, .submission-request-id, .submission-done).
//
//   pnpm --filter @runway/scripts submit-payload payload.input.json            # validate + print + ask
//   pnpm --filter @runway/scripts submit-payload payload.input.json --dry-run  # validate + print only
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const API = "https://nearhackathon.com/api/applications";
const ID_FILE = join(ROOT, ".submission-request-id");
const DONE_FILE = join(ROOT, ".submission-done");
const CONSENT =
  "I agree that the organizers may use these details to review our submission and contact us about this hackathon.";
const SIZES = ["1", "2 - 4", "4 - 6", "6 - 8", "8+"];
const TRACKS = [
  "defi",
  "thesis",
  "privacy",
  "business",
  "swarms",
  "security",
  "agents",
  "realworld",
  "games",
  "nfts",
  "memecoins",
  "social",
  "open",
];
const NEAR_ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export interface Payload {
  requestId: string;
  projectName: string;
  leadName: string;
  email: string;
  size: string;
  tracks: string[];
  nearAddress: string;
  projectUrl: string;
  demoUrl: string;
  idea: string;
  consent: true;
}

const httpUrl = (s: unknown) => {
  if (typeof s !== "string" || s.length > 300) return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};
const len = (s: unknown, lo: number, hi: number) =>
  typeof s === "string" && s.trim().length >= lo && s.length <= hi;

/** Returns the field names that break the contract (empty when valid). */
export function validate(p: Record<string, unknown>): string[] {
  const bad: string[] = [];
  const allowed = [
    "requestId",
    "projectName",
    "leadName",
    "email",
    "size",
    "tracks",
    "nearAddress",
    "projectUrl",
    "demoUrl",
    "idea",
    "consent",
  ];
  for (const k of Object.keys(p)) if (!allowed.includes(k)) bad.push(`${k} (not allowed)`);
  if (
    typeof p.requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(p.requestId)
  )
    bad.push("requestId");
  if (!len(p.projectName, 2, 80)) bad.push("projectName");
  if (!len(p.leadName, 2, 80)) bad.push("leadName");
  if (typeof p.email !== "string" || p.email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email))
    bad.push("email");
  if (typeof p.size !== "string" || !SIZES.includes(p.size)) bad.push("size");
  const tracks = p.tracks;
  if (
    !Array.isArray(tracks) ||
    tracks.length === 0 ||
    new Set(tracks).size !== tracks.length ||
    !tracks.every((t) => TRACKS.includes(t as string))
  )
    bad.push("tracks");
  if (
    typeof p.nearAddress !== "string" ||
    p.nearAddress.length < 2 ||
    p.nearAddress.length > 64 ||
    !NEAR_ACCOUNT.test(p.nearAddress)
  )
    bad.push("nearAddress");
  if (!httpUrl(p.projectUrl)) bad.push("projectUrl");
  if (!httpUrl(p.demoUrl)) bad.push("demoUrl");
  if (!len(p.idea, 20, 2000)) bad.push("idea");
  if (p.consent !== true) bad.push("consent");
  return bad;
}

function requestId(): string {
  if (existsSync(ID_FILE)) return readFileSync(ID_FILE, "utf8").trim();
  const id = randomUUID().toLowerCase();
  writeFileSync(ID_FILE, `${id}\n`);
  return id;
}

async function main() {
  const [input, ...flags] = process.argv.slice(2);
  const dryRun = flags.includes("--dry-run");
  if (!input) throw new Error("usage: submit-payload <payload.input.json> [--dry-run]");
  if (existsSync(DONE_FILE)) {
    console.log(
      `Already submitted (${readFileSync(DONE_FILE, "utf8").trim()}). Never submit twice; request changes at https://nearhackathon.com/request-changes`,
    );
    process.exit(1);
  }
  const fields = JSON.parse(readFileSync(input, "utf8")) as Record<string, unknown>;
  delete fields.requestId;
  const payload = { requestId: requestId(), ...fields } as Record<string, unknown>;
  const bad = validate(payload);
  const body = JSON.stringify(payload);
  console.log(JSON.stringify(payload, null, 2));
  console.log(`\n${body.length} bytes (limit 12000)`);
  if (bad.length > 0 || body.length > 12_000) {
    console.log(`\nInvalid fields: ${bad.join(", ") || "body too large"}. Nothing was sent.`);
    process.exit(1);
  }
  if (dryRun) {
    console.log("\nValid. --dry-run: nothing was sent.");
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(`\nContact notice (consent must be the human's own):\n  "${CONSENT}"`);
  const answer = (
    await rl.question('\nSend this exact payload to the hackathon? Type "yes" to send: ')
  ).trim();
  rl.close();
  if (answer !== "yes") {
    console.log("Not sent.");
    return;
  }

  const res = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body });
  const text = await res.text();
  console.log(`HTTP ${res.status}: ${text.slice(0, 1000)}`);
  switch (res.status) {
    case 201:
      writeFileSync(DONE_FILE, `${new Date().toISOString()} requestId ${String(payload.requestId)}\n`);
      console.log(
        "Saved. The submission is done; fix mistakes at https://nearhackathon.com/request-changes, never by resubmitting.",
      );
      break;
    case 400:
      console.log(
        "A field failed validation: fix the fields listed above and rerun (the same requestId is reused).",
      );
      break;
    case 403:
      console.log("Submissions are not open, or the request looked cross-site. Do not retry.");
      break;
    case 409:
      console.log(
        "Already submitted, or this email has 2 submissions. Do not change the link or email; ask the human.",
      );
      break;
    case 413:
      console.log("Body too large: shorten the idea text.");
      break;
    case 503:
      console.log("Storage unavailable: wait a minute and rerun; the same requestId is reused.");
      break;
    default:
      console.log("Unexpected status; do not resend without checking with the human.");
  }
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
