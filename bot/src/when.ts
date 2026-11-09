import { LOGIN_LIFETIME_SECONDS } from '@molvia/model'
import { t } from './i18n'

const LIFETIME_MINUTES = Math.floor(LOGIN_LIFETIME_SECONDS / 60)

/**
 * «меньше минуты назад», «2 минуты назад» — the age of a login request, in words (MOL-55, Q1).
 *
 * Relative rather than a clock time, by the owner's decision: Telegram does not tell us the
 * person's time zone, so «в 12:34» printed in Yerevan lies by two hours to someone in Belgrade.
 * And the only question this line answers is «is this the one I just started?».
 *
 * **The domain of the function is the request's own lifetime**, and that is what makes four
 * dictionary keys enough instead of a general plural rule copied from the PWA: `previewLogin`
 * only ever hands back a live request, so more than `LOGIN_LIFETIME_SECONDS` cannot have
 * passed. A bot clock running ahead or behind the database's is clamped by the same bounds,
 * which is the one way «21 минут назад» could otherwise have been printed.
 *
 * `floor`, not `round`: rounding up would claim more time has passed than actually has.
 */
export function timeAgo(
  createdAt: Date,
  languageCode: string | undefined,
  now = new Date(),
): string {
  const elapsed = Math.floor((now.getTime() - createdAt.getTime()) / 60_000)
  const minutes = Math.min(Math.max(elapsed, 0), LIFETIME_MINUTES)

  if (minutes === 0) return t(languageCode, 'login.when.now')
  if (minutes === 1) return t(languageCode, 'login.when.one')
  if (minutes < 5) return t(languageCode, 'login.when.few', { n: minutes })
  return t(languageCode, 'login.when.many', { n: minutes })
}

/**
 * «9 ноября», «9 November»: a calendar day in words, without the year — «чек разобран» (MOL-129), the
 * warning before an erasure (MOL-239) and the notice of a sign-in (MOL-361) all say it so, and Telegram
 * dates the message. Read at noon in UTC, so no zone moves the day.
 */
export function dayInWords(language: string, day: string): string {
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`))
}
