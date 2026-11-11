// E22: the mainnet build contains no mock provider, and a gateway app without it has no mock routes.
import { safeLogger, SessionKeys } from "@runway/agent-kit";
import { FixedOracle } from "@runway/fx";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { createGatewayApp } from "../src/server.js";
import { FakeGateway, payinDeps } from "./fake.js";

const bundle = async (network: string) => {
  const r = await build({
    entryPoints: [new URL("../src/main.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    write: false,
    define: { "process.env.NETWORK": JSON.stringify(network) },
    minifySyntax: true,
    logLevel: "silent",
  });
  return r.outputFiles.map((f) => f.text).join("\n");
};

describe("E22: mainnet build", () => {
  it("drops MockInrProvider and the SIMULATED UPI routes", async () => {
    const mainnet = await bundle("mainnet");
    const markers = ["MockInrProvider", "Simulate success", "x-mock-signature", "/mock/upi", "mock_pay_"];
    for (const m of markers) expect(mainnet).not.toContain(m);
    // The testnet build does include them, so the check above is meaningful.
    const testnet = await bundle("testnet");
    for (const m of markers) expect(testnet).toContain(m);
  }, 60_000);

  it("serves 404 on the mock routes when they are not mounted", async () => {
    const { d } = payinDeps(new FakeGateway());
    const session = new SessionKeys(d.signer);
    const app = createGatewayApp({
      network: "mainnet",
      payin: d,
      beneficiary: {
        session,
        provider: d.provider,
        signer: d.signer,
        rpc: d.reader.rpc,
        seenNonces: new Set(),
        blobKey: new Uint8Array(32),
        log: safeLogger(() => {}),
      },
      session,
      oracle: new FixedOracle(8_500),
      log: safeLogger(() => {}),
      registered: async () => true,
    });
    expect((await app.request("/mock/upi/col_1")).status).toBe(404);
    expect((await app.request("/mock/upi/col_1/success", { method: "POST" })).status).toBe(404);
  });
});
