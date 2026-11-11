// Protocol constants shared by the browser and the agents (BUILD_PLAN §9.7, §9.9). One source, so a
// typo can't make the browser sign or seal something an agent then rejects.

/** NEP-413 recipient and signed message for /underwrite. */
export const UNDERWRITE_RECIPIENT = "runway-underwriter";
export const underwriteMessage = (handle: string): string => JSON.stringify({ action: "underwrite", handle });
/** Seal contexts (HKDF info + AAD) for the request and the sealed reply. */
export const UNDERWRITE_CONTEXT = "runway-underwrite";
export const UNDERWRITE_RESPONSE_CONTEXT = "runway-underwrite-response";

/** NEP-413 recipient, signed message and seal context for /inr/beneficiary. */
export const GATEWAY_RECIPIENT = "runway-inr-gateway";
export const beneficiaryMessage = (accountId: string): string =>
  JSON.stringify({ action: "register_beneficiary", account_id: accountId });
export const BENEFICIARY_CONTEXT = "runway-beneficiary";
