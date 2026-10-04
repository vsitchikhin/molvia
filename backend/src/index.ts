import process from 'node:process'
import { env } from './env'
import { getDb } from '@/db'
import { describeMigrationFailure } from '@/db/failure'
import { startEmbedder } from '@/embeddings/embedder'
import { migrateToLatest } from '@/db/migrate'
import { rekeyItems } from '@/db/rekey'
import { createMarketRateRepository } from '@/db/market-rates-repository'
import { createRateRepository } from '@/db/rates-repository'
import { cbaFeed } from '@/rates/cba'
import { fetchCbaRange } from '@/rates/cba-history'
import { marketFiles } from '@/rates/cba-market'
import { cbrFeed } from '@/rates/cbr'
import { erapiFeed } from '@/rates/erapi'
import { refreshAtBoot, startSchedule } from '@/rates/schedule'
import { apiFailureReporter } from '@/failure-reporter'
import { marketRatesRefresh } from '@/usecases/refresh-market-rates'
import { officialRatesRefresh } from '@/usecases/refresh-official-rates'
import { receiptReader } from '@/receipts/reader'
import { httpMetrics, processMetrics } from '@/metrics'
import { buildMetricsServer } from '@/metrics-server'
import { buildServer } from './server'

// Every answer is counted only where somebody scrapes the count (MOL-145): production names the port.
const http = env.METRICS_PORT === undefined ? undefined : httpMetrics()

// The model of the search by meaning loads in the background (MOL-105): the API answers by the
// letters until it is ready, and without its files, for good. The receipt reader is asked only
// where it is named (MOL-125).
const app = buildServer({
  ...(http === undefined ? {} : { metrics: http }),
  ...(env.EMBEDDINGS === 'on'
    ? {
        embedder: (log: Parameters<typeof startEmbedder>[1]) =>
          startEmbedder(env.EMBEDDINGS_DIR, log),
      }
    : {}),
  receiptReader:
    env.RECEIPT_READER_URL === undefined ? null : receiptReader(env.RECEIPT_READER_URL),
})

// Migrations run at boot rather than as a separate deploy step: there is one instance,
// and a schema that lags the code it is deployed with is the worse failure of the two.
try {
  await migrateToLatest()
} catch (error) {
  app.log.error(describeMigrationFailure(error), 'migrations failed')
  process.exit(1)
}

// The search keys the tables of this build give (MOL-109): part of bringing the database to the
// code, so it stops the boot as a migration does — a rollout that fails here rolls back.
try {
  const rekeyed = await rekeyItems(getDb())
  if (rekeyed > 0) app.log.info({ rekeyed }, 'search keys recomputed')
} catch (error) {
  app.log.error(describeMigrationFailure(error), 'search keys failed')
  process.exit(1)
}

// After the migrations, so the first refresh finds its table. The trip never waits for it: it
// reads the cache, and a cache still empty gives a trip without a rate (MOL-39, В-2). The market
// comes after the official rate in the same hour, so today's figures are held against today's
// official one (MOL-137).
if (env.RATES_REFRESH === 'on') {
  const rates = createRateRepository(getDb())
  const rateFailures = apiFailureReporter(getDb, env.OWNER_TELEGRAM_ID ?? null, app.log)
  const official = officialRatesRefresh({
    primary: cbaFeed(),
    fallbacks: [cbrFeed(), erapiFeed()],
    rates,
    log: app.log,
    history: { feed: { fetchRange: (from, to) => fetchCbaRange(from, to) }, rates },
  })
  const market = marketRatesRefresh({
    files: marketFiles(),
    market: createMarketRateRepository(getDb()),
    rates,
    log: app.log,
  })
  const stop = startSchedule(
    async () => {
      try {
        await official()
        await market()
      } catch (error) {
        // A source that does not answer is logged inside and is not a failure; what escapes is ours.
        rateFailures.report(error, { source: 'api', route: 'job:rates' }, 'rates refresh failed')
      }
    },
    {
      immediately: refreshAtBoot(await rates.lastFetchedAt().catch(() => null), new Date(), {
        development: env.NODE_ENV === 'development',
      }),
    },
  )
  app.addHook('onClose', (_instance, done) => {
    stop()
    done()
  })
}

// In a container the API must answer on the container network; in development it has no
// business being on the LAN — the Vite proxy reaches it over the loopback either way.
const host = env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'

// `/metrics` on its own port (MOL-145, В-1): the network of the metrics scrapes it, Caddy never sees it.
// Before the API's `listen` (review №6): a hook added once it listens is refused.
if (http !== undefined && env.METRICS_PORT !== undefined) {
  const running = processMetrics()
  const metrics = buildMetricsServer([http, running])
  app.addHook('onClose', async () => {
    running.stop()
    await metrics.close()
  })
  metrics.listen({ port: env.METRICS_PORT, host }).catch((error: unknown) => {
    app.log.error(error)
    process.exit(1)
  })
}

app.listen({ port: env.API_PORT, host }).catch((error: unknown) => {
  app.log.error(error)
  process.exit(1)
})
