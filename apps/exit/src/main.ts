// Runway exit (BUILD_PLAN T5.6). Reads go straight to the chosen RPC; writes go through the user's
// wallet. Every action here is permissionless or the caller's own: settle, claim_payout,
// claim_withdraw, cancel_withdraw, check_loan.
import "@near-wallet-selector/modal-ui/styles.css";
import { actionCreators, setupWalletSelector, type WalletSelector } from "@near-wallet-selector/core";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupModal } from "@near-wallet-selector/modal-ui";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const DEFAULTS = { rpc: "https://rpc.testnet.fastnear.com", credit: "credit.runway-rama.testnet" };
const out = $<HTMLPreElement>("out");
const rpc = $<HTMLInputElement>("rpc");
const credit = $<HTMLInputElement>("credit");
const TGAS = 10n ** 12n;

const saved = (k: string, d: string) => {
  try {
    return localStorage.getItem(`runway-exit:${k}`) ?? d;
  } catch {
    return d;
  }
};
rpc.value = saved("rpc", DEFAULTS.rpc);
credit.value = saved("credit", DEFAULTS.credit);
for (const el of [rpc, credit])
  el.addEventListener("change", () => {
    try {
      localStorage.setItem(`runway-exit:${el.id}`, el.value.trim());
    } catch {
      /* storage unavailable */
    }
  });

const show = (v: unknown, err = false) => {
  out.className = err ? "err" : "";
  out.textContent = typeof v === "string" ? v : JSON.stringify(v, null, 2);
};

async function view<T>(contract: string, method: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(rpc.value.trim(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "exit",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contract,
        method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  const body = (await res.json()) as { result?: { result: number[] }; error?: unknown };
  if (!body.result) throw new Error(JSON.stringify(body.error ?? body));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(body.result.result))) as T;
}

let selector: WalletSelector | undefined;
const walletEl = $<HTMLDivElement>("wallet");
async function initWallet() {
  selector = await setupWalletSelector({
    network: "testnet",
    modules: [setupMyNearWallet(), setupMeteorWallet()],
  });
  const modal = setupModal(selector, { contractId: credit.value.trim() });
  const render = () => {
    const acct = selector!.store.getState().accounts[0]?.accountId;
    walletEl.innerHTML = "";
    const b = document.createElement("button");
    b.textContent = acct ? `Signed in as ${acct} (sign out)` : "Connect wallet";
    b.className = acct ? "secondary" : "";
    b.onclick = async () => (acct ? (await selector!.wallet()).signOut() : modal.show());
    walletEl.append(b);
  };
  selector.store.observable.subscribe(render);
  render();
}

async function call(receiverId: string, methodName: string, args: Record<string, unknown>, tgas = 100n) {
  if (!selector) throw new Error("wallet not ready");
  const wallet = await selector.wallet();
  return wallet.signAndSendTransaction({
    receiverId,
    actions: [actionCreators.functionCall(methodName, args, tgas * TGAS, 0n)],
  });
}

const run = (f: () => Promise<unknown>) => () => {
  show("Working…");
  f().then(
    (v) => show(v ?? "Done."),
    (e: unknown) => show(e instanceof Error ? e.message : String(e), true),
  );
};

interface Merchant {
  merchant: { settlement: string };
}
const merchant = async () => {
  const m = await view<Merchant | null>(credit.value.trim(), "get_merchant", {
    handle: $<HTMLInputElement>("handle").value.trim(),
  });
  if (!m) throw new Error("no such merchant");
  return m;
};

$("view-merchant").onclick = run(async () => {
  const m = await merchant();
  const state = await view(m.merchant.settlement, "get_state", {});
  return { ...m, settlement_state: state };
});
$("settle").onclick = run(async () => call((await merchant()).merchant.settlement, "settle", {}, 250n));
$("claim-payout").onclick = run(() => call(credit.value.trim(), "claim_payout", {}));
$("view-loan").onclick = run(() =>
  view(credit.value.trim(), "get_loan", { loan_id: $<HTMLInputElement>("loan").value.trim() }),
);
$("check-loan").onclick = run(() =>
  call(credit.value.trim(), "check_loan", { loan_id: $<HTMLInputElement>("loan").value.trim() }, 50n),
);
$("view-request").onclick = run(() =>
  view(credit.value.trim(), "get_withdraw_request", {
    request_id: $<HTMLInputElement>("request").value.trim(),
  }),
);
$("claim-withdraw").onclick = run(() =>
  call(
    credit.value.trim(),
    "claim_withdraw",
    { request_id: $<HTMLInputElement>("request").value.trim() },
    150n,
  ),
);
$("cancel-withdraw").onclick = run(() =>
  call(
    credit.value.trim(),
    "cancel_withdraw",
    { request_id: $<HTMLInputElement>("request").value.trim() },
    50n,
  ),
);
$("view-vault").onclick = run(() => view(credit.value.trim(), "get_vault", {}));

initWallet().catch((e: unknown) =>
  show(`Wallet unavailable (reads still work): ${e instanceof Error ? e.message : String(e)}`, true),
);
