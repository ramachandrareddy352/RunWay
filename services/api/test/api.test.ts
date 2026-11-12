import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Chain } from "../src/chain.js";
import { Keeper } from "../src/keeper.js";
import { PaymentStore } from "../src/store.js";

function fakeChain(merchants: Record<string, string> = { priya: "priya.pay.root.testnet" }) {
  const calls = { settle: [] as string[], mint: [] as [string, bigint][], checkLoan: [] as string[] };
  const chain: Chain = {
    settlementOf: async (h) => merchants[h],
    settle: async (s) => (calls.settle.push(s), `tx-settle-${calls.settle.length}`),
    activeLoanIds: async () => ["2", "5"],
    checkLoan: async (id) => (calls.checkLoan.push(id), `tx-check-${id}`),
    mint: async (to, amount) => (calls.mint.push([to, amount]), `tx-mint-${calls.mint.length}`),
    faucet: async (to, amount) => (calls.mint.push([to, amount]), `tx-faucet-${calls.mint.length}`),
  };
  return { chain, calls };
}

const quiet = { info: () => {}, warn: () => {} };
const post = (path: string, body: unknown, ip = "1.2.3.4") =>
  new Request(`http://api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("API", () => {
  it("A1: POST /payments is idempotent", async () => {
    const store = new PaymentStore();
    const app = createApp({ store, chain: fakeChain().chain, network: "testnet" });
    const body = { handle: "priya", depositAddress: "0xabc1234567" };
    expect((await app.fetch(post("/payments", body))).status).toBe(201);
    expect((await app.fetch(post("/payments", body))).status).toBe(200);
    const list = (await (await app.fetch(new Request("http://api/payments/priya"))).json()) as unknown[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ depositAddress: "0xabc1234567", status: "unknown", kind: "oneclick" });
  });

  it("A5: delivered UPI sales are logged once and settled by the keeper", async () => {
    const store = new PaymentStore();
    const { chain, calls } = fakeChain();
    const app = createApp({ store, chain, network: "testnet" });
    const body = { handle: "priya", paymentRefHash: "7zGf6QEfydKoxAGeBcMhnXXNFAYveBp7Kz9fRvsQEST1" };
    expect((await app.fetch(post("/payments/upi", body))).status).toBe(201);
    expect((await app.fetch(post("/payments/upi", body))).status).toBe(200);
    expect(
      (await app.fetch(post("/payments/upi", { handle: "priya", paymentRefHash: "not base58!" }))).status,
    ).toBe(400);
    await new Keeper(store, chain, async () => ({ status: "PENDING_DEPOSIT" }), quiet).tick();
    expect(calls.settle).toEqual(["priya.pay.root.testnet"]);
    const list = (await (await app.fetch(new Request("http://api/payments/priya"))).json()) as {
      kind: string;
      settledTx: string;
    }[];
    expect(list[0]).toMatchObject({ kind: "upi", settledTx: "tx-settle-1" });
  });

  it("A6: the test faucet mints 1,000 mock USDC, once per account per 10 minutes, never on mainnet", async () => {
    let t = 0;
    const { chain, calls } = fakeChain();
    const app = createApp({ store: new PaymentStore(), chain, network: "testnet", now: () => t });
    expect((await app.fetch(post("/dev/faucet", { account_id: "judge.testnet" }))).status).toBe(201);
    expect(calls.mint).toEqual([["judge.testnet", 1_000_000_000n]]);
    expect((await app.fetch(post("/dev/faucet", { account_id: "judge.testnet" }))).status).toBe(429);
    t += 10 * 60_000;
    expect((await app.fetch(post("/dev/faucet", { account_id: "judge.testnet" }))).status).toBe(201);
    expect((await app.fetch(post("/dev/faucet", { account_id: "Not Valid!" }))).status).toBe(400);
    const main = createApp({ store: new PaymentStore(), chain, network: "mainnet" });
    expect((await main.fetch(post("/dev/faucet", { account_id: "judge.testnet" }))).status).toBe(404);
  });

  it("A3: bad input → 400", async () => {
    const app = createApp({ store: new PaymentStore(), chain: fakeChain().chain, network: "testnet" });
    for (const body of [
      "not json",
      {},
      { handle: "Priya!", depositAddress: "0xabc1234567" },
      { handle: "priya", depositAddress: "short" },
      { handle: "priya", depositAddress: "0xabc1234567", extra: 1 },
    ]) {
      expect((await app.fetch(post("/payments", body))).status).toBe(400);
    }
    expect((await app.fetch(new Request("http://api/payments/NOPE!"))).status).toBe(400);
  });

  it("rate-limits writes per client", async () => {
    const app = createApp({
      store: new PaymentStore(),
      chain: fakeChain().chain,
      network: "testnet",
      writesPerMinute: 2,
      now: () => 0,
    });
    const send = (i: number) =>
      app.fetch(post("/payments", { handle: "priya", depositAddress: `0xabc12345${i}` }));
    expect((await send(1)).status).toBe(201);
    expect((await send(2)).status).toBe(201);
    expect((await send(3)).status).toBe(429);
  });

  it("A4: the simulated-payment route doesn't exist on mainnet", async () => {
    const app = createApp({ store: new PaymentStore(), chain: fakeChain().chain, network: "mainnet" });
    expect(
      (await app.fetch(post("/dev/simulate-payment", { handle: "priya", amount: "1000000" }))).status,
    ).toBe(404);
  });

  it("A4: a simulated payment mints mock USDC, is labelled, and the keeper settles it once", async () => {
    const store = new PaymentStore();
    const { chain, calls } = fakeChain();
    const app = createApp({ store, chain, network: "testnet" });
    const r = await app.fetch(post("/dev/simulate-payment", { handle: "priya", amount: "1000000000" }));
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ simulated: true });
    expect(calls.mint).toEqual([["priya.pay.root.testnet", 1_000_000_000n]]);
    expect((await app.fetch(post("/dev/simulate-payment", { handle: "nobody", amount: "1" }))).status).toBe(
      404,
    );
    expect((await app.fetch(post("/dev/simulate-payment", { handle: "priya", amount: "0" }))).status).toBe(
      400,
    );

    const keeper = new Keeper(store, chain, async () => ({ status: "SUCCESS" }), quiet);
    await keeper.tick();
    await keeper.tick();
    expect(calls.settle).toEqual(["priya.pay.root.testnet"]);
    expect(store.list("priya")[0]).toMatchObject({ kind: "simulated", settledTx: "tx-settle-1" });
  });
});

describe("Keeper", () => {
  it("A2: settles exactly once per SUCCESS transition", async () => {
    const store = new PaymentStore();
    const { chain, calls } = fakeChain();
    store.add({ handle: "priya", depositAddress: "0xdep000001", kind: "oneclick" });
    let status = "PENDING_DEPOSIT";
    const keeper = new Keeper(
      store,
      chain,
      async () => ({ status, amountOut: "5000000" }),
      quiet,
      () => 0,
    );

    await keeper.tick();
    expect(calls.settle).toEqual([]);
    status = "PROCESSING";
    await keeper.tick();
    expect(calls.settle).toEqual([]);
    status = "SUCCESS";
    await keeper.tick();
    await keeper.tick();
    await keeper.tick();
    expect(calls.settle).toEqual(["priya.pay.root.testnet"]);
    expect(store.get("0xdep000001")).toMatchObject({ status: "SUCCESS", amountOut: "5000000" });
  });

  it("retries a failed settle on the next tick and batches one merchant's payments", async () => {
    const store = new PaymentStore();
    const { chain, calls } = fakeChain();
    let fail = true;
    const flaky: Chain = {
      ...chain,
      settle: async (s) => {
        if (fail) throw new Error("rpc down");
        return chain.settle(s);
      },
    };
    store.add({ handle: "priya", depositAddress: "0xdep000001", kind: "oneclick" });
    store.add({ handle: "priya", depositAddress: "0xdep000002", kind: "oneclick" });
    const keeper = new Keeper(
      store,
      flaky,
      async () => ({ status: "SUCCESS" }),
      quiet,
      () => 0,
    );
    await keeper.tick();
    expect(store.toSettle()).toHaveLength(2);
    fail = false;
    await keeper.tick();
    expect(calls.settle).toEqual(["priya.pay.root.testnet"]);
    expect(store.toSettle()).toHaveLength(0);
  });

  it("checks active loans at most once per interval", async () => {
    let t = 3_600_000;
    const { chain, calls } = fakeChain();
    const keeper = new Keeper(
      new PaymentStore(),
      chain,
      async () => ({ status: "x" }),
      quiet,
      () => t,
    );
    await keeper.tick();
    await keeper.tick();
    expect(calls.checkLoan).toEqual(["2", "5"]);
    t += 3_600_000;
    await keeper.tick();
    expect(calls.checkLoan).toEqual(["2", "5", "2", "5"]);
  });
});
