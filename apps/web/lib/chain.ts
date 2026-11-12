// Chain reads.
//   verified: two independent RPCs at the same final block must agree (design §8.2/§9.1). Used for
//             what a payer or merchant acts on: the settlement account a payment goes to, an agent's
//             session key before encrypting to it, and the audit checks.
//   fast:     the first RPC only, for display (stats, lists, balances), so public rate limits are
//             spent on the reads that matter.
import { creditViews, inrViews, settlementViews, viewAgreed, type Viewer } from "@runway/sdk";
import { DEPLOYMENT, RPCS } from "./env";

export const verifiedView: Viewer = (contract, method, args) =>
  viewAgreed(contract, method, args, { rpcs: RPCS });
export const view: Viewer = (contract, method, args) =>
  viewAgreed(contract, method, args, { rpcs: RPCS.slice(0, 1), requireAgreement: false });

/** Display reads. */
export const credit = creditViews(view, DEPLOYMENT.credit);
export const settlements = settlementViews(view);
export const gateway = inrViews(view, DEPLOYMENT.inr);
/** Reads that gate an action (pay-page recipient, agent session keys, audits). */
export const verified = {
  credit: creditViews(verifiedView, DEPLOYMENT.credit),
  gateway: inrViews(verifiedView, DEPLOYMENT.inr),
};

export const tokenBalance = (accountId: string) =>
  view(DEPLOYMENT.token, "ft_balance_of", { account_id: accountId }) as Promise<string>;
export const storageOf = (contract: string, accountId: string) =>
  view(contract, "storage_balance_of", { account_id: accountId }) as Promise<{ total: string } | null>;
