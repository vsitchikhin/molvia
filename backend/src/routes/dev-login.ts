import { randomInt } from 'node:crypto'
import { ZodError } from 'zod'
import { ISSUE } from '@molvia/model'
import type { TelegramUserId } from '@molvia/model'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { answerWithActor } from '@/routes/actors'
import { setSessionCookie } from '@/cookie'
import { InvalidBody } from '@/parse'
import type { SignedIn } from '@/usecases/sign-in'

/**
 * A login with no Telegram in it — the seam development and the end-to-end suite come in
 * through until MOL-54 builds the real door (MOL-52, Р-3; MOL-53, Р-7).
 *
 * It replaces `POST /actors` and the invite code of MOL-8, which went together: the code was
 * there because the handle was open to the whole internet and every call wrote a row. Taking
 * the door off and leaving the handle would have been worse than either. What stands in its
 * place is not a door but an absence — **this module is not in the production bundle at all**
 * (see `server.ts` and `bin/bundle.mjs`), so there is nothing to guess and nothing to guard.
 *
 * The address says what it is, and it changed with what it does: `/dev/actors` created an
 * owner, `/dev/login` signs one in. It is meant to be replaced, not kept.
 *
 * **It stays as narrow as it is on purpose.** It cannot be asked to sign in as somebody named,
 * only as a new person — that would be the very door the epic closes. Integration tests, which
 * build their owners as fixtures, therefore write a session row directly instead of coming
 * through here (`signIn` in `tests/fixtures.ts`).
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
export function devLoginRoute(
  app: FastifyInstance,
  api: { signIn(id: TelegramUserId): Promise<SignedIn> },
): void {
  app.post('/dev/login', { onRequest: refuseAnyBody }, async (_request, reply) => {
    // A Telegram account this person does not have. Random rather than counted, because two
    // seams running side by side (a test file and a dev server on the same database) would
    // otherwise hand out the same number and the second call would answer CONFLICT. Well
    // inside 2^40, so it can never be mistaken for the safe-integer ceiling the column checks.
    const { actor, token, expiresAt } = await api.signIn(randomInt(1, 2 ** 40))

    // The token leaves the server exactly once and only here. `no-store` travels with it — the
    // one function that can set a cookie is the one that says so (Р-6).
    setSessionCookie(reply, token, expiresAt)
    return answerWithActor(reply.code(201), actor)
  })
}
