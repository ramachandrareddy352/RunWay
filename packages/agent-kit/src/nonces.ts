/** Bounded single-use nonce set for NEP-413 checks (oldest entries evicted first). */
export class NonceCache {
  private readonly seen = new Set<string>();
  constructor(private readonly max = 10_000) {}
  has(n: string): boolean {
    return this.seen.has(n);
  }
  add(n: string): void {
    this.seen.add(n);
    if (this.seen.size > this.max) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
  }
}
