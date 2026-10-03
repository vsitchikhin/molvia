import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import type { MetricsSource } from '@/metrics'

/** The format VictoriaMetrics and Prometheus read the text in. */
export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8'

/**
 * `GET /metrics` on a port of its own (MOL-145, owner's В-1), never on the API's: Caddy proxies only
 * the API's port, so no spelling of a path — `/api/metrics`, `/api/%6Detrics`, `/api//metrics` —
 * reaches this one, and the port is published nowhere. Only the network of the metrics scrapes it.
 * No log: a scrape every fifteen seconds is not news.
 */
export function buildMetricsServer(sources: readonly MetricsSource[]): FastifyInstance {
  const app = Fastify({ logger: false })
  app.get('/metrics', async (_request, reply) =>
    reply
      .type(METRICS_CONTENT_TYPE)
      .header('cache-control', 'no-store')
      .send(sources.map((source) => source.render()).join('')),
  )
  return app
}
