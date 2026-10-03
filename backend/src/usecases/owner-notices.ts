import { OWNER_NOTICES_PER_CLAIM, ownerNoticeSchema } from '@molvia/model'
import type { OwnerNotice, OwnerNotices, TelegramUserId } from '@molvia/model'
import type { OwnerNoticeRepository } from '@/db/owner-notices-repository'

/**
 * A stored notice the contract no longer reads, named as such (MOL-148): zod's own error has no
 * frames and no code, so in `failures` it read «ZodError in the claim» — a broken answer, not a
 * notice lost. The name and the code say which; zod's words stay in `cause`, never in the table.
 */
export class OwnerNoticeUnreadable extends Error {
  readonly code = 'OWNER_NOTICE_UNREADABLE'

  constructor(cause: unknown) {
    super('owner notice unreadable', { cause })
    this.name = 'OwnerNoticeUnreadable'
  }
}

/**
 * «Что сказать владельцу» (MOL-143, Р-9 of MOL-149): the notices waiting, handed to the bot and
 * marked in the same statement, with whom to write — the bot keeps no state and does not know the
 * owner. Without an owner nothing is queued, and nothing is claimed either.
 *
 * A stored notice the contract no longer reads is a defect of ours, not the owner's to see: it was
 * marked with the rest and goes through `unreadable` — a failure of the API's, so the owner hears of
 * it. A failure's is never handed out again; a message's is handed again as an unsent one is, and
 * said each time (MOL-148, round 3 Д1, Д2). So a notice's payload changes only so the stored ones
 * still read: a field added is optional, a bound only widens.
 */
export async function claimOwnerNotices(
  notices: Pick<OwnerNoticeRepository, 'claim'>,
  owner: TelegramUserId | null,
  at: Date,
  unreadable: (failure: OwnerNoticeUnreadable) => void,
): Promise<OwnerNotices> {
  if (owner === null) return { to: null, notices: [] }
  const read: OwnerNotice[] = []
  for (const payload of await notices.claim(OWNER_NOTICES_PER_CLAIM, at)) {
    const notice = ownerNoticeSchema.safeParse(payload)
    if (notice.success) read.push(notice.data)
    else unreadable(new OwnerNoticeUnreadable(notice.error))
  }
  return { to: owner, notices: read }
}
