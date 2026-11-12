# Deploying Runway (testnet)

Everything is NEAR testnet with mock USDC and a simulated UPI provider (Amendment A1). Three pieces:

| Piece | What | Where |
|---|---|---|
| Contracts | mock USDC, factory, credit, INR gateway, demo accounts | NEAR testnet under `runway-rama.testnet` (done by `deploy-testnet`) |
| `services/node` | API + keeper, underwriter agent, INR gateway agent, one port | any always-on Node 22 host, or your machine plus a tunnel |
| `apps/web` | the Next.js app | Vercel (`apps/web/vercel.json`) |
| `apps/exit` | single-file exit page | IPFS via Pinata (`pin-exit`), CID stored in `credit.get_exit_app_cid()` |

## 1. Contracts (already deployed)

```bash
make build                                              # res/*.wasm + res/CODE_HASHES.txt
pnpm --filter @runway/scripts deploy-testnet            # idempotent: skips what exists
pnpm --filter @runway/scripts deploy-testnet --verify   # checks only
```

The script signs with near CLI's legacy keychain (`~/.near-credentials/testnet`) and needs the root and
keeper keys there. It writes `deployments/testnet.json` (public: accounts, code hashes, transaction hashes)
and `.env.agents.local` (secret: the two local-mode agent keys; git-ignored).

## 2. The node service

Environment: the root `.env` (see `.env.example`) plus `.env.agents.local`. Run locally:

```bash
pnpm --filter @runway/node start          # reads ../../.env and ../../.env.agents.local
curl http://localhost:8787/               # {"ok":true,"routes":{"api":"/api","underwriter":"/uw","gateway":"/gw"},…}
```

It needs, at minimum: `NEAR_NETWORK=testnet`, `RUNWAY_ROOT`, `KEEPER_ACCOUNT_ID`, `KEEPER_PRIVATE_KEY`
(the keeper owns the mock token, so it can mint SIMULATED payments), `MOCK_WEBHOOK_SECRET`,
`UNDERWRITER_AGENT_ACCOUNT_ID/PRIVATE_KEY`, `GATEWAY_AGENT_ACCOUNT_ID/PRIVATE_KEY`, and when hosted,
`PUBLIC_URL=https://<your host>` (the SIMULATED UPI page links are built from it). Optional:
`NEARAI_API_KEY` (verified statement reading), `NEARAI_DAILY_CALLS`, `DATABASE_PATH`,
`GATEWAY_DATABASE_PATH` (SQLite files; keep them on a persistent disk).

The keeper (every 15 s) and the payout worker (every 10 s) are loops, so the host must stay awake. A free
tier that sleeps stops settlements and payouts until the next request wakes it.

**Docker** (from the repo root):

```bash
docker build -f services/node/Dockerfile -t runway-node .
docker run --env-file .env --env-file .env.agents.local -e PUBLIC_URL=https://<host> -p 8787:8787 -v runway-data:/app/data runway-node
```

**Your machine plus a free tunnel** (no account needed): `cloudflared tunnel --url http://localhost:8787`
prints an `https://….trycloudflare.com` URL; use it as `PUBLIC_URL` and in the web app's settings. The
URL changes each time the tunnel restarts.

**Check it end to end on testnet** (about 30 minutes, because testnet revenue buckets are 300 s):

```bash
pnpm --filter @runway/scripts testnet-e2e    # with the node service running; writes deployments/testnet-e2e.json
```

## 3. Web app on Vercel

1. Import the GitHub repository in Vercel.
2. **Root Directory:** `apps/web`. Leave "Include files outside the root directory" on (the workspace
   packages live in `packages/`). `apps/web/vercel.json` sets the install (only the web app's workspace
   dependencies) and the build (`next build --webpack`).
3. **Node.js version:** 22.x.
4. **Environment variables** (all public):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_NETWORK` | `testnet` |
   | `NEXT_PUBLIC_RUNWAY_ROOT` | `runway-rama.testnet` |
   | `NEXT_PUBLIC_API_URL` | `https://<node host>/api` |
   | `NEXT_PUBLIC_UNDERWRITER_URL` | `https://<node host>/uw` |
   | `NEXT_PUBLIC_GATEWAY_URL` | `https://<node host>/gw` |

   The node host must be **https**: a Vercel (https) page can't call an `http://` API.
5. Deploy. Check `/verify` first: both agents should show "session key matches chain".

Locally: copy `apps/web/.env.example` to `apps/web/.env.local` and run `pnpm --filter @runway/web dev`.

## 4. Exit page on IPFS

```bash
pnpm --filter @runway/exit build
pnpm --filter @runway/scripts pin-exit     # needs PINATA_JWT; also calls credit.set_exit_app_cid
```

## 5. Later: TEE (Phala) and live Razorpay

- **TEE.** `requires_tee` is fixed when the credit contract is created, so a TEE deployment uses a fresh
  credit account (for example `credit2.runway-rama.testnet`) created with `requires_tee = true`, then
  `@runway/config` and the web app point at it. Run each agent image (`tee/underwriter`,
  `tee/inr-gateway`) on Phala with `TEE=1` and *without* the `*_AGENT_PRIVATE_KEY` variables: the agent
  then boots ShadeClient, whose implicit account registers with a real attestation. Approve the image's
  measurements and assign the role with `approve_measurements` and `set_role` (owner). Set
  `environment: TEE` and `deploy_to_phala.enabled: true` in its `deployment.yaml`, run `shade plan`, review
  it, then `shade deploy`.
- **Razorpay.** Test mode can't simulate customer UPI QR payments, and RazorpayX signup was failing, so
  the gateway uses the mock provider. When RazorpayX works: set `INR_PROVIDER=razorpay`, the
  `RAZORPAY_*` keys and `RAZORPAYX_ACCOUNT_NUMBER`, and add the webhook
  `https://<node host>/gw/inr/webhook/razorpay` (events `qr_code.credited`, `payout.*`) in the Razorpay
  dashboard.
