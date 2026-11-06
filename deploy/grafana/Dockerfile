# Grafana with the dashboard, the alarms and their contact point baked in (MOL-145, В-2): what the
# repository says is what runs, and a change made in the interface is not kept (Р-10).
FROM grafana/grafana-oss:13.0.2@sha256:5dad0df181cb644a14e13617b913b261a54f7d4fd4510721dba420929f35bea2

# Grafana's own user owns the alarms: `start.sh` writes whom they go to into the contact point.
COPY --chown=472:0 deploy/grafana/provisioning /etc/grafana/provisioning
COPY deploy/grafana/dashboards /etc/grafana/dashboards
COPY deploy/grafana/start.sh /start.sh

ENTRYPOINT ["/start.sh"]
