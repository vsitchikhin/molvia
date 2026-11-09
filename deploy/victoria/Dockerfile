# VictoriaMetrics single with what it scrapes (MOL-145, В-2): an exact tag, and the config baked in,
# so a change to it is a merge and a rollout, never a file copied to the machine by hand.
FROM victoriametrics/victoria-metrics:v1.156.0@sha256:da8a90ac0912f16589be2b96a6441a2fca4bca415c83783d972d92e3b5b66970 AS runtime

# Alpine's packages up to date, in a layer the release builds afresh (MOL-365, `no-cache-filters`).
RUN apk upgrade --no-cache
COPY deploy/victoria/scrape.yml /etc/victoria/scrape.yml
# Not root (MOL-365): nobody, whose number `volume-owners` in the compose file gives `vmdata`.
USER 65534:65534
