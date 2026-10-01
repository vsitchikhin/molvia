import process from 'node:process'
import { env } from './env'
import { getDb } from '@/db'
import { describeMigrationFailure } from '@/db/failure'
import { migrateToLatest } from '@/db/migrate'
import { createMarketRateRepository } from '@/db/market-rates-repository'
import { createRateRepository } from '@/db/rates-repository'
import { cbaFeed } from '@/rates/cba'
import { fetchCbaRange } from '@/rates/cba-history'
import { marketFiles } from '@/rates/cba-market'
import { cbrFeed } from '@/rates/cbr'
import { erapiFeed } from '@/rates/erapi'
import { refreshAtBoot, startSchedule } from '@/rates/schedule'
import { marketRatesRefresh } from '@/usecases/refresh-market-rates'
import { officialRatesRefresh } from '@/usecases/refresh-official-rates'
import { buildServer } from './server'

const app = buildServer()

// Migrations run at boot rather than as a separate deploy step: there is one instance,
// and a schema that lags the code it is deployed with is the worse failure of the two.
try {
  await migrateToLatest()
} catch (error) {
  app.log.error(describeMigrationFailure(error), 'migrations failed')
  process.exit(1)
}

// After the migrations, so the first refresh finds its table. The trip never waits for it: it
// reads the cache, and a cache still empty gives a trip without a rate (MOL-39, В-2). The market
// comes after the official rate in the same hour, so today's figures are held against today's
// official one (MOL-137).
if (env.RATES_REFRESH === 'on') {
  const rates = createRateRepository(getDb())
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
      await official()
      await market()
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

app.listen({ port: env.API_PORT, host }).catch((error: unknown) => {
  app.log.error(error)
  process.exit(1)
})
