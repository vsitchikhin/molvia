import { ZodError } from 'zod'
import { ISSUE } from '@molvia/model'
import type { FastifyRequest } from 'fastify'
import { InvalidBody } from '@/parse'

/**
 * Documented as having no body, so a body is refused rather than dropped in silence: accepting
 * `{"country":"RU"}` and answering «AM» tells the caller their input was understood when it was
 * discarded. A declared `content-type` counts as a body even with nothing behind it: otherwise
 * an empty payload announced as JSON slipped past here and was refused a step later, by the
 * parser, in different words — the one difference this hook exists to remove.
 *
 * Decided on `onRequest`, by the headers, and that placement is the whole point. Read off
 * `request.body` it ran **after** the body had been buffered and parsed, so a megabyte came
 * back 400 and two megabytes came back 413 — what a caller learned depended on how much they
 * sent rather than on the rule. That property used to be held by `withInvite`, which also stood
 * on `onRequest`; it was lost when the door went (adversarial А9). The same placement catches
 * the other half: a body of literal `null` is a valid JSON document, and read off `request.body`
 * it was indistinguishable from no body at all and quietly wrote a row.
 *
 * Refused through the body seam, which is what turns it into a 400 naming the field — the route
 * assigns no status itself.
 */
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
