# VictoriaMetrics single with what it scrapes (MOL-145, В-2): an exact tag, and the config baked in,
# so a change to it is a merge and a rollout, never a file copied to the machine by hand.
FROM victoriametrics/victoria-metrics:v1.155.0@sha256:f60dc268b54ecf87f6e09d740c2b732838aa9193090cc741417c9f6386a130df

COPY deploy/victoria/scrape.yml /etc/victoria/scrape.yml
