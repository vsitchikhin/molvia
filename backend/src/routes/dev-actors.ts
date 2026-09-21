import { randomInt } from 'node:crypto'
import { ZodError } from 'zod'
import { ISSUE } from '@molvia/model'
import type { Actor, TelegramUserId } from '@molvia/model'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { answerWithActor } from '@/routes/actors'
import { InvalidBody } from '@/parse'

/**
 * A first visit with no Telegram in it — the seam development and the end-to-end suite log in
 * through until MOL-54 builds the real door (MOL-52, Р-3).
 *
 * It replaces `POST /actors` and the invite code of MOL-8, which went together: the code was
 * there because the handle was open to the whole internet and every call wrote a row. Taking
 * the door off and leaving the handle would have been worse than either. What stands in its
 * place is not a door but an absence — **this module is not in the production bundle at all**
 * (see `server.ts` and `bin/bundle.mjs`), so there is nothing to guess and nothing to guard.
 *
 * The address says what it is. MOL-53 turns it into the seam that hands out a session instead
 * of an identity; it is meant to be replaced, not kept.
 */

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
function refuseAnyBody(request: FastifyRequest): Promise<void> {
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
export function devActorRoute(
  app: FastifyInstance,
  api: { create(id: TelegramUserId): Promise<Actor> },
): void {
  app.post('/dev/actors', { onRequest: refuseAnyBody }, async (_request, reply) => {
    // A Telegram account this person does not have. Random rather than counted, because two
    // seams running side by side (a test file and a dev server on the same database) would
    // otherwise hand out the same number and the second call would answer CONFLICT. Well
    // inside 2^40, so it can never be mistaken for the safe-integer ceiling the column checks.
    return answerWithActor(reply.code(201), await api.create(randomInt(1, 2 ** 40)))
  })
}
