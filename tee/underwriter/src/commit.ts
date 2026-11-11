// The commitment helpers live in @runway/sdk so the browser (/audit) can recompute them.
export { canonicalJson, commitment, newSalt, saltToB64, verifyCommitment } from "@runway/sdk";
