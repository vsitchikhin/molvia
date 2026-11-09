# Grafana with the dashboard, the alarms and their contact point baked in (MOL-145, В-2): what the
# repository says is what runs, and a change made in the interface is not kept (Р-10).
# `grafana/grafana`, never `grafana/grafana-oss`: the second stopped at 13.0.2 in June 2026, and no
# release of it would ever reach Dependabot (MOL-365) — the image under the first is the same open source.
FROM grafana/grafana:13.0.12@sha256:28476aa8096cd8d0f658a05a443b605fffb450e57f444335216175d604cfd23d AS runtime

# Alpine's packages up to date, in a layer the release builds afresh (MOL-365, `no-cache-filters`), and
# back to Grafana's own user.
USER root
RUN apk upgrade --no-cache
USER 472

# Grafana's own user owns the alarms: `start.sh` writes whom they go to into the contact point.
COPY --chown=472:0 deploy/grafana/provisioning /etc/grafana/provisioning
COPY deploy/grafana/dashboards /etc/grafana/dashboards
COPY deploy/grafana/start.sh /start.sh

ENTRYPOINT ["/start.sh"]
