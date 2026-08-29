import process from 'node:process'
import { env } from './env'
import { migrateToLatest } from '@/db/migrate'
import { buildServer } from './server'

const app = buildServer()

// Migrations run at boot rather than as a separate deploy step: there is one instance,
// and a schema that lags the code it is deployed with is the worse failure of the two.
try {
  await migrateToLatest()
} catch (error) {
  app.log.error(error, 'migrations failed')
  process.exit(1)
}

// In a container the API must answer on the container network; in development it has no
// business being on the LAN — the Vite proxy reaches it over the loopback either way.
const host = env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'

app.listen({ port: env.API_PORT, host }).catch((error: unknown) => {
  app.log.error(error)
  process.exit(1)
})
