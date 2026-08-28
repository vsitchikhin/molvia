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
RUN npm run build -w @molvia/pwa

# Caddy serves the static build and terminates TLS itself, so there is no certificate
# to renew by hand and no second process to keep alive.
FROM caddy:2-alpine AS runtime
COPY --from=build /repo/apps/pwa/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
