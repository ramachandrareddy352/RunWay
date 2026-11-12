// Payment log (BUILD_PLAN T2.3). SQLite through Node's built-in `node:sqlite` (no native build,
// free hosts run it as-is). The log is untrusted, public data: deposit addresses and statuses only.
import { DatabaseSync } from "node:sqlite";

/** "upi": a UPI sale the INR gateway delivered to the settlement account (it still needs a settle). */
export type PaymentKind = "oneclick" | "simulated" | "upi";

export interface Payment {
  handle: string;
  depositAddress: string;
  kind: PaymentKind;
  status: string;
  amountOut: string | null;
  settledTx: string | null;
  createdAt: number;
  updatedAt: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS payments (
  deposit_address TEXT PRIMARY KEY,
  handle          TEXT NOT NULL,
  kind            TEXT NOT NULL,
  status          TEXT NOT NULL,
  amount_out      TEXT,
  settled_tx      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_handle ON payments(handle, created_at);
`;

const TERMINAL = ["SUCCESS", "REFUNDED", "FAILED"];

interface Row {
  deposit_address: string;
  handle: string;
  kind: PaymentKind;
  status: string;
  amount_out: string | null;
  settled_tx: string | null;
  created_at: number;
  updated_at: number;
}

const toPayment = (r: Row): Payment => ({
  handle: r.handle,
  depositAddress: r.deposit_address,
  kind: r.kind,
  status: r.status,
  amountOut: r.amount_out,
  settledTx: r.settled_tx,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class PaymentStore {
  private readonly db: DatabaseSync;

  constructor(
    path = ":memory:",
    private readonly now: () => number = Date.now,
  ) {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  /** Idempotent: a second add of the same deposit address changes nothing. */
  add(p: {
    handle: string;
    depositAddress: string;
    kind: PaymentKind;
    status?: string;
    amountOut?: string;
  }): { created: boolean } {
    const t = this.now();
    const r = this.db
      .prepare(
        `INSERT OR IGNORE INTO payments
           (deposit_address, handle, kind, status, amount_out, settled_tx, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(p.depositAddress, p.handle, p.kind, p.status ?? "unknown", p.amountOut ?? null, t, t);
    return { created: Number(r.changes) === 1 };
  }

  get(depositAddress: string): Payment | undefined {
    const r = this.db.prepare(`SELECT * FROM payments WHERE deposit_address = ?`).get(depositAddress);
    return r ? toPayment(r as unknown as Row) : undefined;
  }

  list(handle: string, limit = 100): Payment[] {
    return (
      this.db
        .prepare(`SELECT * FROM payments WHERE handle = ? ORDER BY created_at DESC LIMIT ?`)
        .all(handle, limit) as unknown as Row[]
    ).map(toPayment);
  }

  /** 1Click payments whose status can still change. */
  open(): Payment[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM payments WHERE kind = 'oneclick'
             AND status NOT IN (${TERMINAL.map(() => "?").join(",")}) ORDER BY created_at`,
        )
        .all(...TERMINAL) as unknown as Row[]
    ).map(toPayment);
  }

  /** Successful payments the keeper has not settled yet. */
  toSettle(): Payment[] {
    return (
      this.db
        .prepare(`SELECT * FROM payments WHERE status = 'SUCCESS' AND settled_tx IS NULL ORDER BY created_at`)
        .all() as unknown as Row[]
    ).map(toPayment);
  }

  setStatus(depositAddress: string, status: string, amountOut?: string): void {
    this.db
      .prepare(
        `UPDATE payments SET status = ?, amount_out = COALESCE(?, amount_out), updated_at = ?
         WHERE deposit_address = ?`,
      )
      .run(status, amountOut ?? null, this.now(), depositAddress);
  }

  markSettled(depositAddress: string, tx: string): void {
    this.db
      .prepare(`UPDATE payments SET settled_tx = ?, updated_at = ? WHERE deposit_address = ?`)
      .run(tx, this.now(), depositAddress);
  }

  close(): void {
    this.db.close();
  }
}
