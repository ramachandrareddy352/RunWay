# Runway node (API + keeper + underwriter + INR gateway, local mode). Build from the repo root:
#   docker build -f services/node/Dockerfile -t runway-node .
#   docker run --env-file .env --env-file .env.agents.local -p 8787:8787 -v runway-data:/app/data runway-node
FROM node:22-slim
ENV NODE_ENV=production NETWORK=testnet
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.8.0 --activate
# The whole workspace (pnpm's frozen lockfile lists every package); .dockerignore drops secrets and builds.
COPY . .
RUN pnpm install --frozen-lockfile --filter @runway/node...
ENV DATABASE_PATH=/app/data/runway.sqlite GATEWAY_DATABASE_PATH=/app/data/inr-gateway.sqlite PORT=8787
EXPOSE 8787
CMD ["pnpm", "--filter", "@runway/node", "exec", "tsx", "src/main.ts"]
