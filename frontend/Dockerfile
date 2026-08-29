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
RUN npm run build -w @molvia/frontend

# Caddy serves the static build and terminates TLS itself, so there is no certificate
# to renew by hand and no second process to keep alive.
FROM caddy:2-alpine AS runtime
COPY --from=build /repo/frontend/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
