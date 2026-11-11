// Collect store (BUILD_PLAN T4b.4/T4b.6) in SQLite through `node:sqlite`. Holds public-ish state only:
// collect ids, amounts, targets and statuses. No VPAs, account numbers or keys are written here.
import { DatabaseSync } from "node:sqlite";

export type CollectKind =
  | { type: "merchant_sale"; handle: string }
  | { type: "lender_deposit"; beneficiary: string }
  | { type: "repayment"; loan_id: string };

export type CollectStatus = "pending" | "paid" | "delivered" | "failed";

export interface CollectRow {
  collectId: string;
  kind: CollectKind;
  amountPaise: bigint;
  provider: string;
  providerRef: string | null;
  status: CollectStatus;
  createdAt: number;
  expiresAt: number;
  rateEstimate: number;
  usdcEstimate: bigint;
  paymentId: string | null;
  paymentRefHash: string | null;
  /** HMAC(K_app, "vpa:" + vpa): pseudonymous, used for payer diversity. */
  payerRefHash: string | null;
  reason: string | null;
  simulated: boolean;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS collects (
  collect_id TEXT PRIMARY KEY, kind TEXT NOT NULL, amount_paise TEXT NOT NULL, provider TEXT NOT NULL,
  provider_ref TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  rate_estimate INTEGER NOT NULL, usdc_estimate TEXT NOT NULL, payment_id TEXT, payment_ref_hash TEXT,
  payer_ref_hash TEXT, reason TEXT, simulated INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS collects_payment ON collects(payment_id) WHERE payment_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS webhook_events (event_id TEXT PRIMARY KEY, at INTEGER NOT NULL);
`;

interface Row {
  collect_id: string;
  kind: string;
  amount_paise: string;
  provider: string;
  provider_ref: string | null;
  status: CollectStatus;
  created_at: number;
  expires_at: number;
  rate_estimate: number;
  usdc_estimate: string;
  payment_id: string | null;
  payment_ref_hash: string | null;
  payer_ref_hash: string | null;
  reason: string | null;
  simulated: number;
}

const toCollect = (r: Row): CollectRow => ({
  collectId: r.collect_id,
  kind: JSON.parse(r.kind) as CollectKind,
  amountPaise: BigInt(r.amount_paise),
  provider: r.provider,
  providerRef: r.provider_ref,
  status: r.status,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  rateEstimate: r.rate_estimate,
  usdcEstimate: BigInt(r.usdc_estimate),
  paymentId: r.payment_id,
  paymentRefHash: r.payment_ref_hash,
  payerRefHash: r.payer_ref_hash,
  reason: r.reason,
  simulated: r.simulated === 1,
});

export class GatewayStore {
  private readonly db: DatabaseSync;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  addCollect(
    c: Omit<CollectRow, "status" | "paymentId" | "paymentRefHash" | "payerRefHash" | "reason">,
  ): void {
    this.db
      .prepare(
        `INSERT INTO collects (collect_id, kind, amount_paise, provider, provider_ref, status, created_at, expires_at,
           rate_estimate, usdc_estimate, simulated) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      )
      .run(
        c.collectId,
        JSON.stringify(c.kind),
        c.amountPaise.toString(),
        c.provider,
        c.providerRef,
        c.createdAt,
        c.expiresAt,
        c.rateEstimate,
        c.usdcEstimate.toString(),
        c.simulated ? 1 : 0,
      );
  }

  setProviderRef(collectId: string, ref: string): void {
    this.db.prepare("UPDATE collects SET provider_ref = ? WHERE collect_id = ?").run(ref, collectId);
  }

  get(collectId: string): CollectRow | undefined {
    const r = this.db.prepare("SELECT * FROM collects WHERE collect_id = ?").get(collectId) as
      Row | undefined;
    return r ? toCollect(r) : undefined;
  }

  /** Binds a provider payment to a pending collect, once. False if either was already used. */
  claimPayment(
    collectId: string,
    paymentId: string,
    paymentRefHash: string,
    payerRefHash: string | null,
  ): boolean {
    try {
      const r = this.db
        .prepare(
          `UPDATE collects SET status = 'paid', payment_id = ?, payment_ref_hash = ?, payer_ref_hash = ?, reason = NULL
           WHERE collect_id = ? AND status = 'pending' AND payment_id IS NULL`,
        )
        .run(paymentId, paymentRefHash, payerRefHash, collectId);
      return Number(r.changes) === 1;
    } catch {
      return false; // unique index: this payment already paid another collect
    }
  }

  setStatus(collectId: string, status: CollectStatus, reason: string | null = null): void {
    this.db
      .prepare("UPDATE collects SET status = ?, reason = ? WHERE collect_id = ?")
      .run(status, reason, collectId);
  }

  /** Paid but not yet recorded on-chain (retried by the worker). */
  paid(): CollectRow[] {
    return (this.db.prepare("SELECT * FROM collects WHERE status = 'paid'").all() as unknown as Row[]).map(
      toCollect,
    );
  }

  /** True the first time an event id is seen. */
  firstSeen(eventId: string, at: number): boolean {
    const r = this.db
      .prepare("INSERT OR IGNORE INTO webhook_events (event_id, at) VALUES (?, ?)")
      .run(eventId, at);
    return Number(r.changes) === 1;
  }
}
