import Fastify from 'fastify'
import type { FastifyError, FastifyInstance } from 'fastify'
import { DomainError, ERROR } from '@molvia/model'
import type { ErrorCode } from '@molvia/model'
import { healthRoutes } from '@/routes/health'
import { databaseIsReachable } from '@/db'

// The one place where a domain error becomes an HTTP status. Routes never map errors
// themselves, so a code cannot mean 400 in one place and 404 in another.
const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  [ERROR.NOT_FOUND]: 404,
}

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true })

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error instanceof DomainError) {
      return reply.status(STATUS_BY_CODE[error.code] ?? 400).send({ code: error.code })
    }

    app.log.error(error)
    return reply.status(error.statusCode ?? 500).send({ code: ERROR.INTERNAL })
  })

  // The composition point: routes are handed what they need instead of importing it.
  app.register((instance, _options, done) => {
    healthRoutes(instance, { databaseIsReachable })
    done()
  })

  return app
}
