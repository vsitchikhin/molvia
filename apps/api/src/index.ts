import { env } from './env'
import { buildServer } from './server'

const app = buildServer()

app.listen({ port: env.API_PORT, host: '127.0.0.1' }).catch((error: unknown) => {
  app.log.error(error)
  process.exit(1)
})
