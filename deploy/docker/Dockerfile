# syntax=docker/dockerfile:1
# Build from the repository root: docker build -f deploy/docker/Dockerfile .

FROM node:24-trixie-slim@sha256:89c5244bc22a9bc3287d89ebc7e49b9cb5bb84cd40e6175ac3421d5a9f68b95a AS build
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile --filter @flow-sync/server...
COPY packages/protocol/src packages/protocol/src
COPY packages/server/src packages/server/src
RUN pnpm --filter @flow-sync/server build && mkdir -p /out/data

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:a6c34457f6da4295807e051411c7783739c65b997a324fed14e4fa292615ae91
COPY --from=build /src/packages/server/dist/ /app/
COPY --from=build --chown=65532:65532 /out/data /data
ENV NODE_ENV=production PORT=8080 FLOW_SYNC_DATA=/data/flow-sync.db
USER 65532:65532
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["/nodejs/bin/node", "/app/healthcheck.cjs"]
CMD ["/app/node.cjs"]
