// Standalone underwriter (testnet). `services/node` runs the same runtime alongside the API and the
// INR gateway; this entry is for running it on its own (or as its own TEE image).
import { serve } from "@hono/node-server";
import { createUnderwriter } from "./runtime.js";

const port = Number(process.env.PORT ?? 8788);
const u = await createUnderwriter();
serve({ fetch: u.app.fetch, port });
