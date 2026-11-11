// Secrets only (design §8.1). URLs and account IDs live in endpoints.ts and are never read from env.
import { z } from "zod";

export const SecretsSchema = z.object({
  /** NEAR AI Cloud key. Without it the statement source is skipped ("NEAR AI not configured"). */
  NEARAI_API_KEY: z.string().min(10).optional(),
  /** Daily cap on NEAR AI calls (Amendment A1: free credits). */
  NEARAI_DAILY_CALLS: z.coerce.number().int().min(0).default(20),
  /** Funds the agent account's gas (Shade `sponsor`). */
  SPONSOR_ACCOUNT_ID: z.string().min(2).optional(),
  SPONSOR_PRIVATE_KEY: z.string().startsWith("ed25519:").optional(),
  /** Local mode only: a stable derivation path so the agent keeps its account across restarts. */
  AGENT_DERIVATION_PATH: z.string().min(16).optional(),
  PORT: z.coerce.number().int().default(8790),
});

export type Secrets = z.infer<typeof SecretsSchema>;

export const readSecrets = (env: NodeJS.ProcessEnv = process.env): Secrets => SecretsSchema.parse(env);
