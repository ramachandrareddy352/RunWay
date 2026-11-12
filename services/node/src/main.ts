// Runway node: the API (payment log + keeper), the underwriter and the INR gateway in one process,
// behind one port, for free hosts that expose a single URL:
//   /api/*  payments API      → NEXT_PUBLIC_API_URL         = <PUBLIC_URL>/api
//   /uw/*   underwriter       → NEXT_PUBLIC_UNDERWRITER_URL = <PUBLIC_URL>/uw
//   /gw/*   INR gateway       → NEXT_PUBLIC_GATEWAY_URL     = <PUBLIC_URL>/gw
// Agents run in Shade local mode with keys from .env.agents.local (see docs/DEPLOY.md). In a TEE,
// run the two agent images separately instead (tee/*/Dockerfile).
import { serve } from "@hono/node-server";
import { createApiRuntime } from "@runway/api";
import { createGateway } from "@runway/inr-gateway";
import { createUnderwriter } from "@runway/underwriter";
import { Hono } from "hono";
import { cors } from "hono/cors";

const port = Number(process.env.PORT ?? 8787);
const env = process.env;

const api = await createApiRuntime({ ...env, DATABASE_PATH: env.DATABASE_PATH ?? "./data/runway.sqlite" });
const underwriter = await createUnderwriter(env);
const gateway = await createGateway(
  {
    ...env,
    DATABASE_PATH: env.GATEWAY_DATABASE_PATH ?? "./data/inr-gateway.sqlite",
    // Delivered UPI sales go to this process's own API, whose keeper settles them.
    API_URL: env.API_URL ?? `http://127.0.0.1:${port}/api`,
    // The SIMULATED UPI page links are built from this; set it to the public URL when hosted.
    PUBLIC_URL: env.PUBLIC_URL ?? `http://localhost:${port}`,
  },
  { basePath: "/gw" },
);

const app = new Hono();
app.use("*", cors());
app.get("/", (c) =>
  c.json({
    ok: true,
    service: "runway-node",
    routes: { api: "/api", underwriter: "/uw", gateway: "/gw" },
    agents: { underwriter: underwriter.agent, gateway: gateway.agent },
    inr_provider: gateway.provider,
  }),
);
app.route("/api", api.app);
app.route("/uw", underwriter.app);
app.route("/gw", gateway.app);

serve({ fetch: app.fetch, port });
console.log(
  `runway node on :${port} — /api, /uw (agent ${underwriter.agent}), /gw (agent ${gateway.agent}, provider ${gateway.provider})`,
);

const shutdown = () => {
  api.stop();
  underwriter.stop();
  gateway.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
