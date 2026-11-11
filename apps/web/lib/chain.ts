// Chain reads: every view goes to two independent RPCs at the same final block and must agree.
import { creditViews, inrViews, settlementViews, viewAgreed, type Viewer } from "@runway/sdk";
import { DEPLOYMENT, RPCS } from "./env";

export const view: Viewer = (contract, method, args) => viewAgreed(contract, method, args, { rpcs: RPCS });
export const credit = creditViews(view, DEPLOYMENT.credit);
export const settlements = settlementViews(view);
export const gateway = inrViews(view, DEPLOYMENT.inr);
export const tokenBalance = (accountId: string) =>
  view(DEPLOYMENT.token, "ft_balance_of", { account_id: accountId }) as Promise<string>;
export const storageOf = (contract: string, accountId: string) =>
  view(contract, "storage_balance_of", { account_id: accountId }) as Promise<{ total: string } | null>;
