FROM node:22.23.5-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS build
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
FROM caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0 AS runtime
# Not root (MOL-365): the one container that faces the internet runs as a user of its own, whose number
# `frontend-volumes` in the compose file gives the volumes. Ports 80 and 443 stay open to it — the base
# image's caddy carries `cap_net_bind_service`, and Docker opens the low ports inside a container's
# network anyway. Alpine's packages are brought up to date in this layer, which the release builds
# afresh (`no-cache-filters`), so a fix of Alpine comes with the next merge.
RUN apk upgrade --no-cache \
 && addgroup -S -g 10001 caddy && adduser -S -D -H -u 10001 -G caddy caddy \
 && chown caddy:caddy /data /config
COPY --from=build /repo/frontend/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
USER caddy
EXPOSE 80 443
