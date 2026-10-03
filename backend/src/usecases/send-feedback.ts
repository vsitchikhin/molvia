import { DomainError, ERROR, FEEDBACK_DAY_LIMIT, FEEDBACK_HEAVY_DAY_LIMIT } from '@molvia/model'
import type { FeedbackBody, FeedbackSent, TelegramUserId } from '@molvia/model'
import type { FeedbackRepository } from '@/db/feedback-repository'
import { pictureOf } from '@/feedback/picture'

/**
 * «Написать разработчику» (MOL-147): the session's owner writes, and nobody else can be named — the
 * body has no author in it. The build of the API is this server's own, stamped here rather than
 * taken from the phone. The same message again answers with its number and writes nothing; past the
 * day's limit the sheet keeps the text and says to send it tomorrow (MOL-150, Р-3, Р-4). A new
 * message is queued for the owner when there is one (MOL-148); every copy and end-to-end have none.
 *
 * The pictures are read before anything is written (MOL-167, Р-2): each a JPEG within its bounds and
 * stripped of its metadata here, whatever the phone did — a picture refused refuses the message, and
 * the sheet keeps the text and the other pictures.
 */
export async function sendFeedback(
  repository: Pick<FeedbackRepository, 'record'>,
  actorId: string,
  message: FeedbackBody,
  apiBuild: string,
  owner: TelegramUserId | null,
): Promise<{ sent: FeedbackSent; created: boolean }> {
  const pictures = (message.pictures ?? []).map(pictureOf)
  const write = await repository.record(
    actorId,
    message,
    pictures,
    apiBuild,
    FEEDBACK_DAY_LIMIT,
    owner !== null,
  )
  if (write.kind === 'limited') throw new DomainError(ERROR.FEEDBACK_RATE_LIMITED)
  return { sent: { number: write.number }, created: write.kind === 'written' }
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Whether one more body with pictures from `actorId` fits the rolling day, and if it does, counted
 * (adversarial А3). In the process's memory and nowhere else, as the phone's failures are: counted
 * before the body is read, since reading eight megabytes is the cost — the day's limit of messages
 * counts only what was written, and a refused body never is. A restart forgets it; a rollout is rare.
 */
export type HeavyFeedbackLimit = (actorId: string, now: number) => boolean

export function heavyFeedbackLimit(perDay = FEEDBACK_HEAVY_DAY_LIMIT): HeavyFeedbackLimit {
  const taken = new Map<string, number[]>()
  return (actorId, now) => {
    for (const [who, moments] of taken) {
      const fresh = moments.filter((at) => now - at < DAY_MS)
      if (fresh.length === 0) taken.delete(who)
      else taken.set(who, fresh)
    }
    const mine = taken.get(actorId) ?? []
    if (mine.length >= perDay) return false
    taken.set(actorId, [...mine, now])
    return true
  }
}
