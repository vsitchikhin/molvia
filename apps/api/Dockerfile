# Build context is the repository root: the app needs the workspace packages, which
# export TypeScript source rather than a built artifact.
FROM node:22-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/pwa/package.json apps/pwa/
COPY packages/model/package.json packages/model/
COPY packages/client/package.json packages/client/
RUN npm ci --ignore-scripts

COPY . .
RUN node bin/bundle.mjs api

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# One bundled file and the migrations beside it. No node_modules in the image at all:
# nothing to audit, nothing to drift from the lockfile it was built with.
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle

USER node
EXPOSE 3300
CMD ["node", "dist/index.js"]
