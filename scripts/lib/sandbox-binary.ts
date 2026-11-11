// near-workspaces 5.0.0 (JS) bundles nearcore 2.6.2 through near-sandbox 0.1.x. That node lacks host
// functions that near-sdk 5.26 contracts import (e.g. `promise_batch_action_deploy_global_contract`),
// so deployment fails with a link error. The Rust harness (near-workspaces 0.24 -> near-sandbox 0.4.0)
// runs nearcore 2.14.0; this pins the JS demo to the same node, so both harnesses test one version.
//
// near-sandbox 0.1.x only uses NEAR_SANDBOX_BINARY_PATH when the binary already exists there, so it
// is downloaded here first (same URL and archive layout the Rust crate uses).
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { arch, homedir, tmpdir, type } from "node:os";
import { join } from "node:path";

export const NEARCORE_SANDBOX_VERSION = "2.14.0";

function platform(): string {
  if (type() === "Linux" && arch() === "x64") return "Linux-x86_64";
  if (type() === "Darwin" && arch() === "arm64") return "Darwin-arm64";
  throw new Error(`no prebuilt near-sandbox for ${type()} ${arch()}`);
}

/** Ensures the pinned sandbox binary exists and points near-workspaces at it. Returns its path. */
export async function useSandboxBinary(version = NEARCORE_SANDBOX_VERSION): Promise<string> {
  // An explicit override from the caller wins.
  if (process.env.NEAR_SANDBOX_BIN_PATH && process.env.NEAR_SANDBOX_BINARY_PATH) {
    return join(process.env.NEAR_SANDBOX_BINARY_PATH, "near-sandbox");
  }
  const dir = join(homedir(), ".near", `sandbox-${version}`);
  const bin = join(dir, "near-sandbox");
  if (!existsSync(bin)) {
    const url = `https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/${platform()}/${version}/near-sandbox.tar.gz`;
    console.log(`downloading near-sandbox ${version} (one time) from ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download ${url}: HTTP ${res.status}`);
    // Extract into a temp dir and move the binary into place, so an interrupted run never leaves
    // a partial binary behind.
    const tmp = mkdtempSync(join(tmpdir(), "near-sandbox-"));
    try {
      const tgz = join(tmp, "near-sandbox.tar.gz");
      writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
      execFileSync("tar", ["-xzf", tgz, "--strip-components=1", "-C", tmp]);
      chmodSync(join(tmp, "near-sandbox"), 0o755);
      mkdirSync(dir, { recursive: true });
      renameSync(join(tmp, "near-sandbox"), bin);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  process.env.NEAR_SANDBOX_BIN_PATH = "1";
  process.env.NEAR_SANDBOX_BINARY_PATH = dir;
  return bin;
}
