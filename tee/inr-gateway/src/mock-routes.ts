// SIMULATED UPI (sandbox and testnet builds only; BUILD_PLAN T4b.5, §9.9). The page's buttons make
// the mock provider "pay" and then POST its signed webhook to /inr/webhook/mock, the same verification
// path a real provider webhook takes.
import { formatInr } from "@runway/fx";
import type { Hono } from "hono";
import { MockInrProvider } from "./providers/mock.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function mockPage(collectId: string, amountPaise: bigint, expiresAt: Date, paid: boolean): string {
  const id = esc(collectId);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SIMULATED UPI</title>
<style>body{font:16px system-ui,sans-serif;max-width:420px;margin:40px auto;padding:0 16px;color:#1b1b1b;background:#fafafa}
.badge{display:inline-block;background:#b42318;color:#fff;font-weight:700;padding:4px 10px;border-radius:6px;letter-spacing:.04em}
.card{background:#fff;border:1px solid #ddd;border-radius:10px;padding:20px;margin-top:16px}
button{font:inherit;padding:10px 16px;border-radius:8px;border:1px solid #888;margin-right:8px;cursor:pointer}
.ok{background:#027a48;color:#fff;border-color:#027a48}</style></head>
<body><span class="badge">SIMULATED UPI — no real money</span>
<div class="card"><p>Collect <code>${id}</code></p><p style="font-size:28px;margin:8px 0">${esc(formatInr(amountPaise))}</p>
<p>Expires ${esc(expiresAt.toISOString())}</p>
${
  paid
    ? "<p><strong>Already paid.</strong></p>"
    : `<form method="post" action="${id}/success" style="display:inline"><button class="ok">Simulate success</button></form>
<form method="post" action="${id}/failure" style="display:inline"><button>Simulate failure</button></form>`
}</div>
<p style="color:#555;font-size:14px">This page stands in for a UPI app on testnet. A real deployment uses a Razorpay UPI QR instead.</p>
</body></html>`;
}

/** `basePath`: where the gateway app is mounted, so the redirect after a button press stays on it. */
export function mountMockRoutes(app: Hono, provider: MockInrProvider, basePath = ""): void {
  app.get("/mock/upi/:id", (c) => {
    const col = provider.collect(c.req.param("id"));
    if (!col) return c.text("unknown collect", 404);
    return c.html(mockPage(col.collectId, col.amountPaise, col.expiresAt, col.paid));
  });
  app.post("/mock/upi/:id/:outcome", async (c) => {
    const outcome = c.req.param("outcome");
    if (outcome !== "success" && outcome !== "failure") return c.text("not found", 404);
    let ev: { rawBody: Uint8Array; headers: Record<string, string> };
    try {
      ev = provider.simulate(c.req.param("id"), outcome);
    } catch (e) {
      return c.text((e as Error).message, 409);
    }
    const res = await app.request("/inr/webhook/mock", {
      method: "POST",
      body: ev.rawBody,
      headers: ev.headers,
    });
    if (c.req.header("accept")?.includes("application/json")) return c.json({ ok: res.ok, simulated: true });
    return c.redirect(`${basePath}/mock/upi/${encodeURIComponent(c.req.param("id"))}`, 303);
  });
}

export { MockInrProvider };
