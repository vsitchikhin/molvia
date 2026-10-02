# Build context is the repository root: the app needs the workspace packages, which
# export TypeScript source rather than a built artifact.
FROM node:22-alpine AS build
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
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# One bundled file and the migrations beside it. One module beside them, and nothing else of
# node_modules: onnxruntime, whose native library no bundle can hold (MOL-105).
COPY --from=build /repo/backend/dist ./dist
COPY --from=build /repo/backend/drizzle ./drizzle
COPY --from=build /ort ./node_modules
# The model inside the image, with the notice its terms ask a copy to carry. Microsoft's telemetry
# of onnxruntime off here as well as in the code: no third party sees anything of ours.
COPY --from=build /model ./model
ENV EMBEDDINGS_DIR=/app/model ORT_DISABLE_TELEMETRY=1

# What `/health` names as the version (MOL-90): `git describe` of the commit, handed in by
# `release.yml`. Last, so a new version does not throw away the layers above it.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

USER node
EXPOSE 3300
CMD ["node", "dist/index.js"]
