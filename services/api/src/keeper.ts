// Keeper loop (BUILD_PLAN T2.3): poll 1Click for open payments, settle each SUCCESS exactly once,
// and roll active loans hourly. Claims and withdrawals are user actions; the keeper never does them.
import type { Chain } from "./chain.js";
import type { PaymentStore } from "./store.js";

export type StatusFn = (depositAddress: string) => Promise<{ status: string; amountOut?: string }>;

export interface KeeperLog {
  info(msg: string): void;
  warn(msg: string): void;
}

export class Keeper {
  private lastLoanCheck = 0;

  constructor(
    private readonly store: PaymentStore,
    private readonly chain: Chain,
    private readonly status: StatusFn,
    private readonly log: KeeperLog,
    private readonly now: () => number = Date.now,
    private readonly loanCheckEveryMs = 60 * 60_000,
  ) {}

  /** One pass. Errors are logged per item so one bad payment doesn't block the rest. */
  async tick(): Promise<void> {
    for (const p of this.store.open()) {
      try {
        const s = await this.status(p.depositAddress);
        if (s.status !== p.status) this.store.setStatus(p.depositAddress, s.status, s.amountOut);
      } catch (e) {
        this.log.warn(`status ${p.depositAddress}: ${(e as Error).message}`);
      }
    }

    // Settle each successful payment once. `settle()` is idempotent on-chain (it only splits new
    // inflow), so a retry after a crash between the call and markSettled is harmless.
    const settledThisTick = new Set<string>();
    for (const p of this.store.toSettle()) {
      try {
        const settlement = await this.chain.settlementOf(p.handle);
        if (!settlement) {
          this.log.warn(`no settlement for ${p.handle}`);
          continue;
        }
        // Several payments to one merchant settle in a single call.
        const tx = settledThisTick.has(settlement) ? "batched" : await this.chain.settle(settlement);
        settledThisTick.add(settlement);
        this.store.markSettled(p.depositAddress, tx);
        this.log.info(`settled ${p.handle} (${p.depositAddress}) in ${tx}`);
      } catch (e) {
        this.log.warn(`settle ${p.handle}: ${(e as Error).message}`);
      }
    }

    if (this.now() - this.lastLoanCheck >= this.loanCheckEveryMs) {
      this.lastLoanCheck = this.now();
      try {
        for (const id of await this.chain.activeLoanIds()) {
          await this.chain.checkLoan(id).catch((e: Error) => this.log.warn(`check_loan ${id}: ${e.message}`));
        }
      } catch (e) {
        this.log.warn(`active loans: ${(e as Error).message}`);
      }
    }
  }
}
