// The keeper's view of the chain. Everything it does is permissionless (`settle`, `check_loan`)
// except minting mock USDC for SIMULATED testnet payments (the keeper owns the mock token).
import { failover } from "@runway/sdk";
import { Account, connect, KeyPair, keyStores, providers } from "near-api-js";

type KeyPairString = Parameters<typeof KeyPair.fromString>[0];

export interface Chain {
  /** The merchant's settlement account, or undefined if the handle isn't registered. */
  settlementOf(handle: string): Promise<string | undefined>;
  /** Calls `settle()` on a settlement account; returns the transaction hash. */
  settle(settlement: string): Promise<string>;
  activeLoanIds(): Promise<string[]>;
  checkLoan(loanId: string): Promise<string>;
  /** Mints mock USDC to `to` (testnet/sandbox only). */
  mint(to: string, amount: bigint): Promise<string>;
  /** Test faucet (testnet/sandbox only): registers `to` with the token if needed, then mints. */
  faucet(to: string, amount: bigint): Promise<string>;
}

const TGAS = 10n ** 12n;

export interface NearChainConfig {
  networkId: string;
  /** One RPC, or several tried in order when one is unavailable (see `failover` in @runway/sdk). */
  nodeUrl: string | string[];
  keeperId: string;
  keeperKey: string;
  credit: string;
  token: string;
}

export async function nearChain(c: NearChainConfig): Promise<Chain> {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(c.networkId, c.keeperId, KeyPair.fromString(c.keeperKey as KeyPairString));
  // near-api-js 5's re-exported NearConfig doesn't resolve under NodeNext, so the type is asserted.
  const urls = [c.nodeUrl].flat();
  const provider = failover(urls.map((url) => new providers.JsonRpcProvider({ url })));
  const near = await connect({ networkId: c.networkId, nodeUrl: urls[0], keyStore, provider } as Parameters<
    typeof connect
  >[0]);
  const keeper: Account = await near.account(c.keeperId);
  const view = <T>(contractId: string, methodName: string, args: object) =>
    keeper.viewFunction({ contractId, methodName, args }) as Promise<T>;
  const call = async (contractId: string, methodName: string, args: object, tgas: bigint, deposit = 0n) => {
    const r = await keeper.functionCall({
      contractId,
      methodName,
      args,
      gas: tgas * TGAS,
      attachedDeposit: deposit,
    });
    return r.transaction.hash as string;
  };

  return {
    async settlementOf(handle) {
      const m = await view<{ merchant: { settlement: string } } | null>(c.credit, "get_merchant", { handle });
      return m?.merchant.settlement;
    },
    settle: (settlement) => call(settlement, "settle", {}, 250n),
    async activeLoanIds() {
      const loans = await view<{ id: string }[]>(c.credit, "get_active_loans", {});
      return loans.map((l) => l.id);
    },
    checkLoan: (loanId) => call(c.credit, "check_loan", { loan_id: loanId }, 50n),
    mint: (to, amount) => call(c.token, "mint", { account_id: to, amount: amount.toString() }, 30n),
    async faucet(to, amount) {
      // The account must exist; registering storage for a name nobody owns would waste the deposit.
      await near.connection.provider.query({
        request_type: "view_account",
        finality: "final",
        account_id: to,
      });
      const registered = await view<unknown>(c.token, "storage_balance_of", { account_id: to });
      if (!registered)
        await call(
          c.token,
          "storage_deposit",
          { account_id: to, registration_only: true },
          30n,
          1_250_000_000_000_000_000_000n,
        );
      return call(c.token, "mint", { account_id: to, amount: amount.toString() }, 30n);
    },
  };
}
