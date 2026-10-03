# VictoriaMetrics single with what it scrapes (MOL-145, В-2): an exact tag, and the config baked in,
# so a change to it is a merge and a rollout, never a file copied to the machine by hand.
FROM victoriametrics/victoria-metrics:v1.153.0

COPY deploy/victoria/scrape.yml /etc/victoria/scrape.yml
