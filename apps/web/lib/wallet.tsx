"use client";
// Wallets (BUILD_PLAN T5.1): wallet-selector 10.1.4 with Meteor, MyNearWallet, HOT and Intear.
// Components use `useWallet()` from this file, so tests can provide a fake wallet.
import "@near-wallet-selector/modal-ui/styles.css";
import { setupHotWallet } from "@near-wallet-selector/hot-wallet";
import { setupIntearWallet } from "@near-wallet-selector/intear-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { useWalletSelector, WalletSelectorProvider } from "@near-wallet-selector/react-hook";
import { freshNonce, toBase64, type SignedMessage } from "@runway/sdk";
import { createContext, useContext, useMemo, type ReactNode } from "react";

export const TGAS = 10n ** 12n;

export interface CallOptions {
  gas?: bigint;
  deposit?: bigint;
}

export interface RunwayWallet {
  accountId: string | null;
  signIn(): void;
  signOut(): Promise<void>;
  call(
    contractId: string,
    method: string,
    args: Record<string, unknown>,
    opts?: CallOptions,
  ): Promise<unknown>;
  /** NEP-413 with a fresh time-stamped nonce, in the shape agents verify. */
  signNep413(message: string, recipient: string): Promise<SignedMessage>;
}

export const WalletContext = createContext<RunwayWallet | null>(null);

export function useWallet(): RunwayWallet {
  const w = useContext(WalletContext);
  if (!w) throw new Error("useWallet outside a wallet provider");
  return w;
}

function Bridge({ children }: { children: ReactNode }) {
  const ws = useWalletSelector();
  const value = useMemo<RunwayWallet>(
    () => ({
      accountId: ws.signedAccountId,
      signIn: ws.signIn,
      signOut: ws.signOut,
      call: (contractId, method, args, opts) =>
        ws.callFunction({
          contractId,
          method,
          args,
          gas: String(opts?.gas ?? 100n * TGAS),
          deposit: String(opts?.deposit ?? 0n),
        }),
      async signNep413(message, recipient) {
        if (!ws.signedAccountId) throw new Error("connect a wallet first");
        const nonce = freshNonce();
        const s = await ws.signNep413Message(message, ws.signedAccountId, recipient, nonce);
        return {
          accountId: s.accountId,
          publicKey: s.publicKey.toString(),
          signature: toBase64(s.signature),
          message,
          nonce: toBase64(nonce),
          recipient,
          callbackUrl: null,
        };
      },
    }),
    [ws],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const config = useMemo(
    () => ({
      network: "testnet" as const,
      modules: [setupMeteorWallet(), setupMyNearWallet(), setupHotWallet(), setupIntearWallet()],
    }),
    [],
  );
  return (
    <WalletSelectorProvider config={config}>
      <Bridge>{children}</Bridge>
    </WalletSelectorProvider>
  );
}
