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

COPY . .
RUN node bin/bundle.mjs backend

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# One bundled file and the migrations beside it. No node_modules in the image at all:
# nothing to audit, nothing to drift from the lockfile it was built with.
COPY --from=build /repo/backend/dist ./dist
COPY --from=build /repo/backend/drizzle ./drizzle

# What `/health` names as the version (MOL-90): `git describe` of the commit, handed in by
# `release.yml`. Last, so a new version does not throw away the layers above it.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

USER node
EXPOSE 3300
CMD ["node", "dist/index.js"]
