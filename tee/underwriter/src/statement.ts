// Statements are parsed to plain text inside the agent before anything goes to NEAR AI
// (design §8.4 step 6, BUILD_PLAN T4.3): CSV with papaparse, PDF with pdfjs-dist, max 20 pages.
import { fromBase64, fromUtf8 } from "@runway/sdk";
import Papa from "papaparse";

export const MAX_PAGES = 20;
export const MAX_TEXT_CHARS = 200_000;

export interface StatementFile {
  name: string;
  mime: "text/csv" | "application/pdf";
  data_b64: string;
}

export async function statementText(f: StatementFile): Promise<string> {
  const bytes = fromBase64(f.data_b64);
  const text = f.mime === "text/csv" ? csvText(fromUtf8(bytes)) : await pdfText(bytes);
  if (text.trim().length === 0) throw new Error("statement has no text");
  return text.slice(0, MAX_TEXT_CHARS);
}

export function csvText(csv: string): string {
  const r = Papa.parse<string[]>(csv.trim(), { skipEmptyLines: true });
  if (r.errors.length > 0 && r.data.length === 0) throw new Error("unreadable CSV");
  return r.data.map((row) => row.map((c) => c.trim()).join(" | ")).join("\n");
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: bytes, useSystemFonts: false });
  const doc = await task.promise;
  try {
    const pages = Math.min(doc.numPages, MAX_PAGES);
    const out: string[] = [];
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      out.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
    }
    return out.join("\n");
  } finally {
    await task.destroy();
  }
}
