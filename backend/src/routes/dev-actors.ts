import { randomInt } from 'node:crypto'
import { ZodError } from 'zod'
import { ISSUE } from '@molvia/model'
import type { Actor, TelegramUserId } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
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
export function devActorRoute(
  app: FastifyInstance,
  api: { create(id: TelegramUserId): Promise<Actor> },
): void {
  app.post('/dev/actors', async (request, reply) => {
    // Documented as having no body, so a body is refused rather than dropped in silence:
    // accepting `{"country":"RU"}` and answering «AM» tells the caller their input was
    // understood when it was discarded. Refused through the body seam, which is what
    // turns it into a 400 naming the field — the route assigns no status itself.
    if (request.body !== undefined && request.body !== null) {
      throw new InvalidBody(
        new ZodError([
          { code: 'custom', path: ['body'], message: ISSUE.BODY_INVALID, input: request.body },
        ]),
      )
    }

    // A Telegram account this person does not have. Random rather than counted, because two
    // seams running side by side (a test file and a dev server on the same database) would
    // otherwise hand out the same number and the second call would answer CONFLICT. Well
    // inside 2^40, so it can never be mistaken for the safe-integer ceiling the column checks.
    return answerWithActor(reply.code(201), await api.create(randomInt(1, 2 ** 40)))
  })
}
