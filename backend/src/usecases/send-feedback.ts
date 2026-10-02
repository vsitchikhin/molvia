import { DomainError, ERROR, FEEDBACK_DAY_LIMIT } from '@molvia/model'
import type { FeedbackBody, FeedbackSent } from '@molvia/model'
import type { FeedbackRepository } from '@/db/feedback-repository'

/**
 * «Написать разработчику» (MOL-147): the session's owner writes, and nobody else can be named — the
 * body has no author in it. The build of the API is this server's own, stamped here rather than
 * taken from the phone. The same message again answers with its number and writes nothing; past the
 * day's limit the sheet keeps the text and says to send it tomorrow (MOL-150, Р-3, Р-4).
 */
export async function sendFeedback(
  repository: FeedbackRepository,
  actorId: string,
  message: FeedbackBody,
  apiBuild: string,
): Promise<{ sent: FeedbackSent; created: boolean }> {
  const write = await repository.record(actorId, message, apiBuild, FEEDBACK_DAY_LIMIT)
  if (write.kind === 'limited') throw new DomainError(ERROR.FEEDBACK_RATE_LIMITED)
  return { sent: { number: write.number }, created: write.kind === 'written' }
}
