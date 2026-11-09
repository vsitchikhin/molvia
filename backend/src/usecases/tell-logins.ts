import {
  DomainError,
  ERROR,
  LOGIN_NOTICES_PER_CLAIM,
  loginNoticeSchema,
  signedInClock,
} from '@molvia/model'
import type {
  DueLoginNotices,
  EndSessionFromBot,
  LoginNotice,
  LoginNoticesTold,
} from '@molvia/model'
import type { AuthTransact } from '@/db/auth-unit-of-work'
import type { LoginNoticeRepository } from '@/db/login-notices-repository'

/** A notice taken off the queue that the bot's contract would not read: the message is lost, and said. */
export class LoginNoticeUnreadable extends Error {
  readonly code = 'LOGIN_NOTICE_UNREADABLE'

  constructor(cause: unknown) {
    super('login notice unreadable', { cause })
    this.name = 'LoginNoticeUnreadable'
  }
}

/**
 * «В ваш аккаунт вошло новое устройство» (MOL-361): the oldest notice of each account the bot has not
 * told, marked as handed. The API decides, the bot only sends (MOL-101 Р-1) and says what went
 * (`loginNoticesTold`); a bot that dies between the two loses the message, and nothing sends it twice.
 */
export async function claimLoginNotices(
  notices: Pick<LoginNoticeRepository, 'claim'>,
  unreadable: (failure: LoginNoticeUnreadable) => void,
): Promise<DueLoginNotices> {
  const due: LoginNotice[] = []
  for (const handed of await notices.claim(LOGIN_NOTICES_PER_CLAIM)) {
    const notice = loginNoticeSchema.safeParse({
      telegramUserId: handed.telegramUserId,
      sessionId: handed.sessionId,
      deviceName: handed.deviceName,
      ...signedInClock(handed.signedInAt, handed.country),
    })
    if (notice.success) due.push(notice.data)
    else unreadable(new LoginNoticeUnreadable(notice.error))
  }
  return { notices: due }
}

/** The bot's word on a claim: what went is let go, what did not is handed again (adversarial А1). */
export async function loginNoticesTold(
  notices: Pick<LoginNoticeRepository, 'told'>,
  word: LoginNoticesTold,
): Promise<void> {
  await notices.told(word)
}

/**
 * «Это не я — завершить» (MOL-361): ends the one session the button names, of the account Telegram says
 * pressed it. Another account's, a missing one, one already ended and a malformed id are one
 * `NOT_FOUND` — the bot then says the sign-in is over. Counted in `login_days` in the same transaction.
 */
export async function endSessionFromBot(
  transact: AuthTransact,
  sessionId: string,
  { telegramUserId }: EndSessionFromBot,
): Promise<void> {
  await transact(async ({ sessions, requests }) => {
    if (!(await sessions.removeForTelegram(telegramUserId, sessionId))) {
      throw new DomainError(ERROR.NOT_FOUND)
    }
    await requests.endedByNotice()
  })
}
