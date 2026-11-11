# Runway INR gateway image (BUILD_PLAN T4b.4). NETWORK is baked in, so each network has its own
# measurements. Build from the repo root: docker build -f tee/inr-gateway/Dockerfile .
# Pin the base by digest before a TEE deployment (`docker buildx imagetools inspect node:22-slim`).
FROM node:22-slim
ARG NETWORK=testnet
ENV NETWORK=${NETWORK} NODE_ENV=production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.8.0 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY tee/inr-gateway ./tee/inr-gateway
RUN pnpm install --frozen-lockfile --filter @runway/inr-gateway...
USER node
EXPOSE 8791
CMD ["pnpm", "--filter", "@runway/inr-gateway", "start"]
