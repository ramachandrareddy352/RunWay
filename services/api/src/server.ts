// Standalone API: `pnpm --filter @runway/api dev` with the variables from `.env` (see .env.example).
// services/node runs the same runtime together with the agents.
import { serve } from "@hono/node-server";
import { createApiRuntime } from "./runtime.js";

const port = Number(process.env.PORT ?? 8787);
const api = await createApiRuntime();
serve({ fetch: api.app.fetch, port });
console.log(`runway api on :${port}`);
