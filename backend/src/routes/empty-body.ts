import { ZodError } from 'zod'
import { ISSUE } from '@molvia/model'
import type { FastifyRequest } from 'fastify'
import { InvalidBody } from '@/parse'

/** Refuse an announced body before buffering it, including a JSON null. */
export function refuseAnyBody(request: FastifyRequest): Promise<void> {
  const { 'content-length': length, 'content-type': type } = request.headers
  const announced =
    type !== undefined ||
    request.headers['transfer-encoding'] !== undefined ||
    (length !== undefined && length !== '0')
  if (!announced) return Promise.resolve()

  throw new InvalidBody(
    new ZodError([{ code: 'custom', path: ['body'], message: ISSUE.BODY_INVALID, input: null }]),
  )
}
