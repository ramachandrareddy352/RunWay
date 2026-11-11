// Node-only: fixtures generated from the Rust types (contracts/tests: fixtures_are_current).
// Kept out of the main entry so browsers can import `@runway/config`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const readFixture = (name: string): unknown => JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));

/** Shade local-mode mock attestation (`create_mock_dstack_attestation`). */
export const mockAttestation = (): unknown => readFixture("mock-attestation.json");
/** All-zero measurements accepted in local mode (`create_mock_full_measurements_hex`). */
export const mockMeasurements = (): unknown => readFixture("mock-measurements.json");
/** Default (all-zero) PPID accepted in local mode. */
export const defaultPpid = (): unknown => readFixture("default-ppid.json");
