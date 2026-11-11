import type { PayoutRequest } from "@runway/sdk";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RupeeDeposit, RupeeWithdraw, type LendRupeeDeps } from "../components/LendRupees";
import { PayoutSettings, type SettingsDeps } from "../components/PayoutSettings";
import { PayUpi, type CollectState, type UpiDeps } from "../components/PayUpi";

function upiDeps(states: CollectState[]): UpiDeps & { calls: unknown[] } {
  const calls: unknown[] = [];
  let i = 0;
  return {
    calls,
    pollMs: 10,
    collect: async (body) => {
      calls.push(body);
      return {
        collect_id: "col_1",
        provider: "mock",
        mock_url: "http://gw/mock/upi/col_1",
        rate_ppu_estimate: 8_500,
        usdc_estimate: "100000000",
        expires_at: new Date(Date.now() + 900_000).toISOString(),
        simulated: true,
      };
    },
    collectStatus: async () => states[Math.min(i++, states.length - 1)]!,
    explorerFor: () => "https://testnet.nearblocks.io/address/inr",
  };
}

describe("W10: /pay UPI tab (mock)", () => {
  it("quotes, links the SIMULATED page, and reaches delivered with a transaction link", async () => {
    const deps = upiDeps([
      { status: "pending" },
      { status: "delivered", payment_ref_hash: "HashAbc1234567890" },
    ]);
    render(<PayUpi handle="priya" deps={deps} />);
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "8500" } });
    fireEvent.click(screen.getByRole("button", { name: "Get UPI QR" }));
    expect(await screen.findByText("Open the SIMULATED UPI page")).toBeTruthy();
    expect(screen.getByText(/100\.00/)).toBeTruthy();
    expect(deps.calls[0]).toEqual({ kind: "merchant_sale", handle: "priya", amount_paise: "850000" });
    await waitFor(() => expect(screen.getByTestId("collect-status").textContent).toContain("delivered"));
    expect(screen.getByText("NEAR transaction").getAttribute("href")).toContain("nearblocks");
  });
});

function lendDeps(over: Partial<LendRupeeDeps> = {}): LendRupeeDeps {
  let shares = 0n;
  return {
    ...upiDeps([{ status: "pending" }, { status: "delivered", payment_ref_hash: "H" }]),
    account: "investor.testnet",
    hasShareStorage: async () => true,
    registerShareStorage: async () => undefined,
    shares: async () => shares,
    hasBeneficiary: async () => true,
    requestWithdraw: async () => "5",
    claimWithdraw: async () => undefined,
    latestPayout: async () => null,
    ...over,
    collectStatus: async () => {
      shares = 99_448_079n;
      return { status: "delivered", payment_ref_hash: "H" };
    },
  };
}

describe("W11: /lend ₹ deposit and ₹ withdrawal", () => {
  it("checks share storage first", async () => {
    const register = vi.fn(async () => undefined);
    render(
      <RupeeDeposit
        deps={lendDeps({ hasShareStorage: async () => false, registerShareStorage: register })}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Register share storage" }));
    await waitFor(() => expect(register).toHaveBeenCalled());
  });

  it("shows the new shares once the deposit is delivered", async () => {
    render(<RupeeDeposit deps={lendDeps()} />);
    fireEvent.change(await screen.findByLabelText(/Amount/), { target: { value: "8500" } });
    fireEvent.click(screen.getByRole("button", { name: "Get UPI QR" }));
    await waitFor(() => expect(screen.getByTestId("shares").textContent).toContain("99.44"));
  });

  it("requests, claims and follows the payout to Paid", async () => {
    const paid: PayoutRequest = {
      id: "2",
      kind: "lender_withdrawal",
      beneficiary: "investor.testnet",
      reference: "5",
      usdc: "100022956",
      inr_paise: "850195",
      rate_ppu: 8_500,
      utr_hash: "U",
      failure_reason: null,
      created_sec: 1,
      status: "Paid",
    };
    render(<RupeeWithdraw cooldownSec={120} deps={lendDeps({ latestPayout: async () => paid })} />);
    fireEvent.change(await screen.findByLabelText(/Shares/), { target: { value: "99.448079" } });
    fireEvent.click(screen.getByRole("button", { name: "Request ₹ withdrawal" }));
    fireEvent.click(await screen.findByRole("button", { name: "Claim" }));
    await waitFor(() => expect(screen.getByTestId("payout").textContent).toContain("Paid"));
    expect(screen.getByTestId("payout").textContent).toContain("₹8,501.95");
  });

  it("blocks a ₹ withdrawal without a registered beneficiary", async () => {
    render(<RupeeWithdraw cooldownSec={120} deps={lendDeps({ hasBeneficiary: async () => false })} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Shares/), { target: { value: "1" } });
    expect((screen.getByRole("button", { name: "Request ₹ withdrawal" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe("W12: /merchant/settings", () => {
  it("toggles the payout mode on-chain, registers a beneficiary with a masked display, and lists ₹ payouts", async () => {
    let mode: "Usdc" | "Inr" = "Usdc";
    const register = vi.fn(async () => ({ masked: "pr***@upi" }));
    const deps: SettingsDeps = {
      payoutMode: async () => mode,
      setPayoutMode: async (m) => {
        mode = m;
      },
      registerBeneficiary: register,
      history: async () => [
        {
          id: "1",
          kind: "merchant_share",
          beneficiary: "priya.testnet",
          reference: "priya",
          usdc: "82160000",
          inr_paise: "698360",
          rate_ppu: 8_500,
          utr_hash: "U",
          failure_reason: null,
          created_sec: 1,
          status: "Paid",
        },
      ],
    };
    render(<PayoutSettings deps={deps} />);
    fireEvent.click(await screen.findByRole("button", { name: /Switch to ₹/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Switch to USDC/ })).toBeTruthy());
    expect(mode).toBe("Inr");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Priya" } });
    fireEvent.change(screen.getByLabelText("UPI ID"), { target: { value: "priya@upi" } });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    expect((await screen.findByTestId("masked")).textContent).toContain("pr***@upi");
    expect(register).toHaveBeenCalledWith({ type: "vpa", name: "Priya", vpa: "priya@upi" });
    expect(screen.queryByText("priya@upi")).toBeNull();

    const table = screen.getByRole("table", { name: "payout history" });
    expect(table.textContent).toContain("₹6,983.60");
  });
});
