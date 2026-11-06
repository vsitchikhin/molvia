FROM node:22.23.4-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY bot/package.json bot/
COPY frontend/package.json frontend/
COPY packages/model/package.json packages/model/
COPY packages/client/package.json packages/client/
RUN npm ci --ignore-scripts

COPY . .
RUN node bin/bundle.mjs bot

FROM node:22.23.4-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/bot/dist ./dist
USER node
CMD ["node", "dist/index.js"]
