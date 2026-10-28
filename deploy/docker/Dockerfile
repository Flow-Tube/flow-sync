# syntax=docker/dockerfile:1
# Build from the repository root: docker build -f deploy/docker/Dockerfile .

FROM node:25-trixie-slim@sha256:aabbe39553d15ede8a97cc60c9e1a97034ff772afcf696ea42b94e7f5f2ec71b AS build
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
