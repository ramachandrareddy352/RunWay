import { STATUSES, type Token, type VerifyReport } from "@runway/sdk";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PayCrypto, type PayCryptoDeps } from "../components/PayCrypto";
import { StatusTimeline } from "../components/StatusTimeline";

const fixture = JSON.parse(
  // Vitest runs from apps/web; jsdom gives import.meta.url a non-file scheme.
  readFileSync(join(process.cwd(), "../../packages/sdk/test/fixtures/oneclick-dry-quote.json"), "utf8"),
) as { quote: Record<string, unknown>; quoteRequest: Record<string, unknown> };

const tokens = [
  {
    assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
    decimals: 6,
    blockchain: "base",
    symbol: "USDC",
    price: 1,
    priceUpdatedAt: "",
  },
  {
    assetId: "nep141:bsc-usdt.omft.near",
    decimals: 18,
    blockchain: "bsc",
    symbol: "USDT",
    price: 1,
    priceUpdatedAt: "",
  },
] as unknown as Token[];

const BASE_REFUND = "0x000000000000000000000000000000000000dEaD".toLowerCase();

function setup(over: Partial<PayCryptoDeps> = {}, mode: "live" | "preview" = "live", amount = 25_000_000n) {
  const deps: PayCryptoDeps = {
    tokens: async () => tokens,
    quote: async () => structuredClone(fixture),
    status: async () => ({ status: "PENDING_DEPOSIT" }),
    pollMs: 60_000,
    ...over,
  };
  render(
    <PayCrypto
      handle="priya"
      settlement="priya.pay.runway.testnet"
      amount={amount}
      mode={mode}
      deps={deps}
    />,
  );
  return deps;
}

async function quoteWith(assetLabel: RegExp) {
  await screen.findByRole("option", { name: assetLabel });
  fireEvent.change(screen.getByLabelText("asset"), { target: { value: tokens[0]!.assetId } });
  fireEvent.change(screen.getByLabelText(/Refund address/), { target: { value: BASE_REFUND } });
  fireEvent.click(screen.getByRole("button", { name: "Get quote" }));
}

describe("W1: no deposit address for a tampered quote", () => {
  it("shows the failed checks and no address or QR", async () => {
    // A live quote whose recipient was swapped for an attacker's account.
    const tampered = structuredClone(fixture);
    tampered.quoteRequest.recipient = "attacker.near";
    tampered.quoteRequest.dry = false;
    tampered.quote.depositAddress = "0xattackerdeposit";
    tampered.quote.deadline = new Date(Date.now() + 600_000).toISOString();
    setup({ quote: async () => tampered });
    await quoteWith(/USDC on base/);
    await screen.findByLabelText("quote verification");
    const recipient = document.querySelector('[data-check="recipient"]')!;
    expect(recipient.getAttribute("data-ok")).toBe("false");
    expect(document.querySelector('[data-check="signature"]')!.getAttribute("data-ok")).toBe("false");
    expect(screen.queryByTestId("deposit")).toBeNull();
    expect(screen.queryByText("0xattackerdeposit")).toBeNull();
  });

  it("shows the address only when every check and the status re-read pass", async () => {
    const ok: VerifyReport = {
      ok: true,
      checks: [{ id: "signature", ok: true, skipped: false, detail: "ok" }],
    };
    const good = structuredClone(fixture);
    good.quote.depositAddress = "0xdeposit123";
    const recheck = vi.fn(async () => ({
      ok: true,
      checks: [{ id: "status" as const, ok: true, skipped: false, detail: "PENDING_DEPOSIT" }],
    }));
    setup({ quote: async () => good, verify: () => ok, recheck });
    await quoteWith(/USDC on base/);
    expect(await screen.findByTestId("deposit")).toBeTruthy();
    expect(screen.getByText("0xdeposit123")).toBeTruthy();
    expect(recheck).toHaveBeenCalledWith("0xdeposit123");
  });
});

describe("W2: status timeline", () => {
  it("renders all seven statuses and marks the current one", () => {
    render(<StatusTimeline status="PROCESSING" />);
    const items = [...document.querySelectorAll("[data-status]")].map((e) => e.getAttribute("data-status"));
    expect(items).toEqual([...STATUSES]);
    expect(document.querySelector('[data-status="PROCESSING"]')!.getAttribute("data-state")).toBe("current");
    expect(document.querySelector('[data-status="PENDING_DEPOSIT"]')!.getAttribute("data-state")).toBe(
      "done",
    );
  });

  it("explains refunds", () => {
    render(<StatusTimeline status="REFUNDED" />);
    expect(screen.getByText(/went back to the refund address/)).toBeTruthy();
  });
});

describe("W3: chain minimums", () => {
  it("disables BNB Chain below $1,000 and enables it above", async () => {
    setup({}, "live", 25_000_000n);
    const bsc = (await screen.findByRole("option", { name: /USDT on bsc/ })) as HTMLOptionElement;
    expect(bsc.disabled).toBe(true);
    expect(bsc.textContent).toContain("minimum $1,000");
  });

  it("allows it at $1,000", async () => {
    setup({}, "live", 1_000_000_000n);
    const bsc = (await screen.findByRole("option", { name: /USDT on bsc/ })) as HTMLOptionElement;
    expect(bsc.disabled).toBe(false);
  });
});

describe("preview mode (testnet)", () => {
  it("verifies the dry quote and then makes a SIMULATED payment", async () => {
    const simulate = vi.fn(async () => ({ depositAddress: "sim-abc" }));
    setup({ simulate }, "preview", 5_000_000n); // the fixture is a 5 USDC dry quote
    await quoteWith(/USDC on base/);
    const pay = await screen.findByRole("button", { name: /SIMULATED testnet USDC/ });
    fireEvent.click(pay);
    await waitFor(() => expect(simulate).toHaveBeenCalledWith(5_000_000n));
    expect(await screen.findByText("sim-abc")).toBeTruthy();
  });
});
