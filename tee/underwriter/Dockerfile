# Runway underwriter image (BUILD_PLAN T3.1). NETWORK is baked in, so each network has its own
# measurements. Build from the repo root: docker build -f tee/underwriter/Dockerfile .
# Pin the base by digest before a TEE deployment (`docker buildx imagetools inspect node:22-slim`).
FROM node:22-slim
ARG NETWORK=testnet
ENV NETWORK=${NETWORK} NODE_ENV=production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.8.0 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY tee/underwriter ./tee/underwriter
RUN pnpm install --frozen-lockfile --filter @runway/underwriter...
USER node
EXPOSE 8790
CMD ["pnpm", "--filter", "@runway/underwriter", "start"]
