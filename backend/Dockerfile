# Build context is the repository root: the app needs the workspace packages, which
# export TypeScript source rather than a built artifact.
FROM node:22.23.4-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY bot/package.json bot/
COPY frontend/package.json frontend/
COPY packages/model/package.json packages/model/
COPY packages/client/package.json packages/client/
RUN npm ci --ignore-scripts

# The model of the search by meaning (MOL-105), fetched before the source is copied: a layer that
# changes with its specification only, checked file by file against the sha256 written there.
COPY bin/fetch-model.mjs bin/
COPY backend/src/embeddings/model.json backend/src/embeddings/
RUN node bin/fetch-model.mjs /model

# onnxruntime, the one module the bundle cannot hold: its JavaScript, and of its native builds only
# the one of this image's machine — 45 MB of the package's 288.
ARG TARGETARCH
RUN arch="$([ "$TARGETARCH" = arm64 ] && echo arm64 || echo x64)" \
 && mkdir -p /ort/onnxruntime-node/bin/napi-v6/linux \
 && cp -r node_modules/onnxruntime-node/package.json node_modules/onnxruntime-node/dist /ort/onnxruntime-node/ \
 && cp -r "node_modules/onnxruntime-node/bin/napi-v6/linux/$arch" /ort/onnxruntime-node/bin/napi-v6/linux/ \
 && cp -r node_modules/onnxruntime-common /ort/

COPY . .
RUN node bin/bundle.mjs backend

# Debian, not alpine (MOL-105): onnxruntime's native build is for glibc.
FROM node:22.23.4-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS runtime
WORKDIR /app
ENV NODE_ENV=production

# The runtime is `node` alone (MOL-365): npm, npx, corepack and yarn of the base image run nothing
# here, and every finding trivy had in this image was theirs. Debian's packages are brought up to
# date in the same layer, which the release builds afresh (`no-cache-filters`), so a fix of the
# distribution comes with the next merge rather than with the base's digest moved.
RUN apt-get update && apt-get upgrade -y --no-install-recommends && rm -rf /var/lib/apt/lists/* \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v* \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg

# One bundled file and the migrations beside it. One module beside them, and nothing else of
# node_modules: onnxruntime, whose native library no bundle can hold (MOL-105).
COPY --from=build /repo/backend/dist ./dist
COPY --from=build /repo/backend/drizzle ./drizzle
COPY --from=build /ort ./node_modules
# The model inside the image, with the notice its terms ask a copy to carry. Microsoft's telemetry
# of onnxruntime off here as well as in the code: no third party sees anything of ours.
COPY --from=build /model ./model
ENV EMBEDDINGS_DIR=/app/model ORT_DISABLE_TELEMETRY=1

# What `/health` names as the version (MOL-90): the last tag, the releases since it and the commit
# (MOL-371), handed in by `release.yml`. Last, so a new version does not throw away the layers above it.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

USER node
EXPOSE 3300
CMD ["node", "dist/index.js"]
