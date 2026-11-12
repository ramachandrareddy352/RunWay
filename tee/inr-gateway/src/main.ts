// Standalone INR gateway (testnet). `services/node` runs the same runtime alongside the API and the
// underwriter; this entry is for running it on its own (or as its own TEE image).
import { serve } from "@hono/node-server";
import { createGateway } from "./runtime.js";

const port = Number(process.env.PORT ?? 8789);
const g = await createGateway();
serve({ fetch: g.app.fetch, port });
