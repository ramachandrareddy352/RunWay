# Runbook

Record every deployment here: accounts, transaction hashes and code hashes (BUILD_PLAN §8).

## Sandbox (local)

No accounts, keys or funds. Run everything inside WSL/Linux:

```bash
make setup          # pnpm install
make build          # bash scripts/build-contracts.sh  → res/*.wasm, res/test/*.wasm, res/CODE_HASHES.txt
make test           # contract unit tests + sandbox integration tests + TypeScript tests
make sandbox-demo   # full loop on a private sandbox; prints DEMO PASSED
```

Toolchain: Rust 1.95.0 (native, from `rust-toolchain.toml`), Rust 1.86.0 with `wasm32-unknown-unknown` (contract wasm), `cargo-near` 0.23.0, Node 22, pnpm 10.8.0. See BUILD_PLAN T0.1.

## Testnet

Deployed 2026-11-12 with `pnpm --filter @runway/scripts deploy-testnet` (idempotent; `--verify` re-checks).
The full record, including every step's transaction, is [deployments/testnet.json](../deployments/testnet.json).

| Step | Account | Transaction |
|---|---|---|
| Deploy mock USDC (owner: keeper) | `musdc.runway-rama.testnet` | [B2KGYFoX9n…](https://testnet.nearblocks.io/txns/B2KGYFoX9nyDjYcpFJYaqbnZPNZ5qWhs1E8d8uJsjWH7) |
| Deploy factory | `pay.runway-rama.testnet` | [855horA7W3…](https://testnet.nearblocks.io/txns/855horA7W3rkZAQ7DAv3pZPeBFfmiFJAdGrPm3kbR9sp) |
| Deploy credit | `credit.runway-rama.testnet` | [7hf2Ao9m6F…](https://testnet.nearblocks.io/txns/7hf2Ao9m6F4YMby2DQ9g1hDDfCwL7bW8UkHwts3Mfrir) |
| Deploy INR gateway | `inr.runway-rama.testnet` | [Dhi4w479r7…](https://testnet.nearblocks.io/txns/Dhi4w479r7z4xuhEsfoSMD62LAMT4GdQQvYogdjDneeZ) |
| Lender deposit 10,000 USDC | `lender.runway-rama.testnet` | [5qzj7pK8zc…](https://testnet.nearblocks.io/txns/5qzj7pK8zcKn2y9bvFC42pXH3RzcR8KAxArAfrSbLLcd) |
| Seed reserve 100 USDC | `runway-rama.testnet` | [12Ur6GYYPD…](https://testnet.nearblocks.io/txns/12Ur6GYYPD4efG6wWnCmhTS1mnJzspxyLopgw5kdsEWg) |
| Register underwriter agent | `uwagent.runway-rama.testnet` | [u8hbwREtot…](https://testnet.nearblocks.io/txns/u8hbwREtotEJ3oz4j2EWuCADREdRdgHbnmxvupi9BRD) |
| Register INR gateway agent | `gwagent.runway-rama.testnet` | [A5KC2FxTvr…](https://testnet.nearblocks.io/txns/A5KC2FxTvrUJJEFVmqKByoGfCtdFYWKGYwuSDmCqEMw3) |
| credit.set_inr_gateway | `credit.runway-rama.testnet` | [7E31unB6NQ…](https://testnet.nearblocks.io/txns/7E31unB6NQiM12iLLupd6kRZ8JgaNszBzEJhqATtJhQe) |
| Fund gateway float 5,000 USDC | `inr.runway-rama.testnet` | [H92wLVRCvs…](https://testnet.nearblocks.io/txns/H92wLVRCvs6wV65MWofQRVfvHBCsLQFkE8SHQutWi8EG) |
| Register merchant priya | `priya.pay.runway-rama.testnet` | [5oXCKT8HJN…](https://testnet.nearblocks.io/txns/5oXCKT8HJNGMmfUBb7fQ63dSNN59encuzaxhaZea48tF) |

Code hashes (match `res/CODE_HASHES.txt`):

- `musdc.runway-rama.testnet`: `DQ4Sox5vMiwLfL8G7AZun7gkVTjjzims62tSSh2ugwCy`
- `pay.runway-rama.testnet`: `HcBpma1QhqXm9i1t5fL9hA8k4osWApJPS28A6EUBw1RJ`
- `credit.runway-rama.testnet`: `7ZzY9xYc92dbwqki4hMHADw7uSXUKJk2FRRoGZXHdeiX`
- `inr.runway-rama.testnet`: `2bLtpuJuVh1drEkKJBGfvAJka7f5WBzXvyDddy4qnUhV`

Exit page: IPFS `bafybeiaybfhshzhm24gfgzly2zy5zd3lvecb5b3sj2agg4fheti2g6nns4`, recorded with `credit.set_exit_app_cid` ([tx](https://testnet.nearblocks.io/txns/7sCSQ8WGsQSLfFtaKnoztPZkDTDZEZmbbGiwpv613hbw)).

Agents (Shade local mode, `requires_tee = false`): `uwagent.runway-rama.testnet` (Underwriter) and `gwagent.runway-rama.testnet` (InrGateway). Their keys are in the git-ignored `.env.agents.local`.

End-to-end check: `pnpm --filter @runway/scripts testnet-e2e` (results in [deployments/testnet-e2e.json](../deployments/testnet-e2e.json)).

## Mainnet

Not deployed (Amendment A1: testnet only).
