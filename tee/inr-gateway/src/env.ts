// Secrets and runtime switches only (BUILD_PLAN T4b.4). URLs and account ids live in endpoints.ts.
import { z } from "zod";

export const GatewayEnv = z.object({
  /** "mock" until Razorpay test mode is chosen (SP11) and RazorpayX is set up (Amendment A1). */
  INR_PROVIDER: z.enum(["mock", "razorpay"]).default("mock"),
  RAZORPAY_KEY_ID: z
    .string()
    .regex(/^rzp_(test|live)_/)
    .optional(),
  RAZORPAY_KEY_SECRET: z.string().min(8).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(8).optional(),
  RAZORPAYX_ACCOUNT_NUMBER: z
    .string()
    .regex(/^\d{8,20}$/)
    .optional(),
  MOCK_WEBHOOK_SECRET: z.string().min(16).optional(),
  /** Where this gateway is reachable (used for the SIMULATED UPI page links). */
  PUBLIC_URL: z.string().url().default("http://localhost:8791"),
  SPONSOR_ACCOUNT_ID: z.string().min(2).optional(),
  SPONSOR_PRIVATE_KEY: z.string().startsWith("ed25519:").optional(),
  AGENT_DERIVATION_PATH: z.string().min(16).optional(),
  DATABASE_PATH: z.string().default("./data/inr-gateway.sqlite"),
  PORT: z.coerce.number().int().default(8791),
});

export type GatewayEnv = z.infer<typeof GatewayEnv>;
export const readEnv = (env: NodeJS.ProcessEnv = process.env): GatewayEnv => GatewayEnv.parse(env);
