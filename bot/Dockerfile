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
RUN node bin/bundle.mjs bot

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/bot/dist ./dist
USER node
CMD ["node", "dist/index.js"]
