import type { Oracle } from "@runway/fx";
import { describe, expect, it } from "vitest";
import { CollectRefused, createCollect, handleWebhook, paymentRefHash } from "../src/payin.js";
import { FakeGateway, payinDeps, USDC } from "./fake.js";

const sale = { kind: "merchant_sale" as const, handle: "priya", amount_paise: "850000" };

describe("collects (E23)", () => {
  it("quotes ₹8,500 at ₹85 as 100 USDC and returns the SIMULATED page", async () => {
    const { d } = payinDeps();
    const c = await createCollect(sale, d);
    expect(c).toMatchObject({
      provider: "mock",
      rate_ppu_estimate: 8_500,
      usdc_estimate: String(100n * USDC),
      simulated: true,
    });
    expect(c.mock_url).toBe(`http://gw.test/mock/upi/${c.collect_id}`);
  });

  it("refuses when the float is short, the oracle is paused, or pay-ins are paused", async () => {
    const short = new FakeGateway();
    short.free = 50n * USDC;
    await expect(createCollect(sale, payinDeps(short).d)).rejects.toThrow("not enough gateway float");

    const { d } = payinDeps();
    const pausedOracle: Oracle = {
      read: async () => ({
        paused: true,
        ratePpu: 0,
        at: 0,
        used: [],
        dropped: [],
        reason: "only 1 fresh source(s)",
      }),
    };
    await expect(createCollect(sale, { ...d, oracle: pausedOracle })).rejects.toThrow(
      "FX oracle paused: only 1 fresh source(s)",
    );

    const paused = new FakeGateway();
    paused.paused = true;
    await expect(createCollect(sale, payinDeps(paused).d)).rejects.toThrow("pay-ins are paused");
  });

  it("checks the target exists", async () => {
    const { d } = payinDeps();
    await expect(createCollect({ ...sale, handle: "nobody" }, d)).rejects.toThrow("unknown merchant");
    await expect(
      createCollect({ kind: "lender_deposit", beneficiary: "stranger.test", amount_paise: "850000" }, d),
    ).rejects.toThrow("share storage");
    await expect(
      createCollect({ kind: "repayment", loan_id: "99", amount_paise: "850000" }, d),
    ).rejects.toThrow("not active");
    await expect(createCollect({ ...sale, amount_paise: "10000001" }, d)).rejects.toBeInstanceOf(
      CollectRefused,
    );
  });
});

describe("webhooks", () => {
  it("records a verified payment once, even when the webhook arrives 3 times (E18)", async () => {
    const { d, g, provider } = payinDeps();
    const c = await createCollect(sale, d);
    const ev = provider.simulate(c.collect_id, "success", "Customer@OkAxis");
    for (let i = 0; i < 3; i++) expect(await handleWebhook(ev.rawBody, ev.headers, d)).toBe(true);
    expect(g.calls.filter((x) => x.method === "record_payin")).toHaveLength(1);
    expect(g.receipts.size).toBe(1);
    const row = d.store.get(c.collect_id)!;
    expect(row.status).toBe("delivered");
    expect(row.paymentRefHash).toBe(paymentRefHash("mock", row.paymentId!));
    const call = g.calls.find((x) => x.method === "record_payin")!;
    expect(call.args).toMatchObject({
      inr_paise: "850000",
      rate_ppu: 8_500,
      kind: { type: "merchant_sale", handle: "priya" },
    });
    expect(call.args.payer_ref_hash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{40,}$/);
    expect(g.free).toBe(900n * USDC);
  });

  it("E16: a bad signature, or one computed over re-serialised JSON, is rejected and nothing is recorded", async () => {
    const { d, g, provider } = payinDeps();
    const c = await createCollect(sale, d);
    const ev = provider.simulate(c.collect_id, "success");
    const forged = { ...ev.headers, "x-mock-signature": "0".repeat(64) };
    expect(await handleWebhook(ev.rawBody, forged, d)).toBe(false);
    // Same JSON, different bytes (pretty-printed): the signature over the original bytes no longer matches.
    const reserialised = new TextEncoder().encode(
      JSON.stringify(JSON.parse(new TextDecoder().decode(ev.rawBody)), null, 2),
    );
    expect(await handleWebhook(reserialised, ev.headers, d)).toBe(false);
    expect(g.calls).toHaveLength(0);
    expect(d.store.get(c.collect_id)!.status).toBe("pending");
  });

  it("E17: a valid webhook whose payment doesn't match the collect records nothing", async () => {
    for (const tamper of ["amount", "currency", "status", "method", "collect"] as const) {
      const { d, g, provider } = payinDeps();
      const c = await createCollect(sale, d);
      const ev = provider.simulate(c.collect_id, "success");
      const id = (JSON.parse(new TextDecoder().decode(ev.rawBody)) as { payment_id: string }).payment_id;
      const p = await provider.fetchPayment(id);
      if (tamper === "amount") p.amountPaise = 850_001n;
      if (tamper === "currency") p.currency = "USD";
      if (tamper === "status") p.status = "authorized";
      if (tamper === "method") p.method = "card";
      if (tamper === "collect") p.notes = { ...p.notes, collect_id: "col_unknown" };
      await handleWebhook(ev.rawBody, ev.headers, d);
      expect(
        g.calls.filter((x) => x.method === "record_payin"),
        tamper,
      ).toHaveLength(0);
    }
  });

  it("marks a failed UPI payment as failed without recording it", async () => {
    const { d, g, provider } = payinDeps();
    const c = await createCollect(sale, d);
    const ev = provider.simulate(c.collect_id, "failure");
    await handleWebhook(ev.rawBody, ev.headers, d);
    expect(d.store.get(c.collect_id)!.status).toBe("failed");
    expect(g.calls).toHaveLength(0);
  });

  it("retries record_payin with the same hash after an RPC failure", async () => {
    const { d, g, provider } = payinDeps();
    g.failNext = "record_payin";
    const c = await createCollect(sale, d);
    const ev = provider.simulate(c.collect_id, "success");
    await handleWebhook(ev.rawBody, ev.headers, d);
    const calls = g.calls.filter((x) => x.method === "record_payin");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.args.payment_ref_hash).toBe(calls[1]!.args.payment_ref_hash);
    expect(d.store.get(c.collect_id)!.status).toBe("delivered");
  });
});
