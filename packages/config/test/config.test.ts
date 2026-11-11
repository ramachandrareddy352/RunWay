import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { policyJson, profiles } from "../src/index.js";

describe("profiles", () => {
  it("sandbox policy JSON matches the Rust test harness policy exactly", () => {
    const rust = JSON.parse(
      readFileSync(new URL("../fixtures/policy-sandbox.json", import.meta.url), "utf8"),
    ) as unknown;
    expect(policyJson(profiles.sandbox.policy)).toEqual(rust);
  });

  it("mainnet requires TEE and has tiny caps", () => {
    expect(profiles.mainnet.requiresTee).toBe(true);
    expect(profiles.mainnet.policy.maxExposurePerMerchant).toBe(20_000_000n);
  });
});
