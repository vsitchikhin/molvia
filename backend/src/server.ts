import Fastify from 'fastify'
import type { FastifyError, FastifyInstance } from 'fastify'
import { DomainError, ERROR, ISSUE, errorResponseSchema, isWireCode } from '@molvia/model'
import type { ErrorCode, ErrorResponse } from '@molvia/model'
import { InvalidBody } from '@/routes/body'
import { healthRoutes } from '@/routes/health'
import { databaseIsReachable } from '@/db'

// The one place where a domain error becomes an HTTP status. Routes never map errors
// themselves, so a code cannot mean 400 in one place and 404 in another.
const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  [ERROR.NOT_FOUND]: 404,
}

// The handler answers with the contract the client parses, so it checks its own reply
// against it rather than trusting that a path it built fits.
function answer(response: ErrorResponse): ErrorResponse {
  const parsed = errorResponseSchema.safeParse(response)
  return parsed.success ? parsed.data : { code: response.code }
}

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true })

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error instanceof DomainError) {
      return reply.status(STATUS_BY_CODE[error.code] ?? 400).send({ code: error.code })
    }

    // Only a body parsed at the seam, never any ZodError: a row that stopped matching its
    // schema is the server's fault and has to keep falling through to the log below.
    if (error instanceof InvalidBody) {
      const issue = error.issues[0]
      const code = isWireCode(issue?.message) ? issue.message : ISSUE.BODY_INVALID
      const details = issue?.path.join('.')
      return reply.status(400).send(answer({ code, ...(details ? { details } : {}) }))
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
