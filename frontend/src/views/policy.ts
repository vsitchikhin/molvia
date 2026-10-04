import { calendarDay } from '@/days'

/**
 * The revision of «Условия использования» and «Данные и приватность» (MOL-95, owner's decision В-1):
 * the day both pages say they were last edited, and the fingerprint of their text in every language
 * on that day. **Any edit of either page is a new revision**, and `policy.test.ts` will not let the
 * text change without one — so nothing on them changes in silence.
 *
 * **A revision is not an edition.** The edition a person accepts is `POLICY_VERSION` of the model,
 * raised by hand only for a change that matters — a new kind of data, a new recipient, a new purpose,
 * a change of the terms — and only that puts everybody through the consent screen again. A line added
 * to the privacy page by a task about data moves the day and the fingerprint alone. `version` is
 * written here too, so raising the edition is an edit of this file and of the day.
 */
export const POLICY_REVISION = {
  day: '2026-10-04',
  version: 1,
  digest: 'ef986a7521d3913b6603bddce35e44f62964d179f25cdccb30f3508cc4931a4e',
} as const

/** «Редакция от 4 октября 2026 г.» — the subtitle of both pages. */
export function revisedOn(
  t: (key: string, values: Record<string, string>) => string,
  locale: string,
): string {
  const day = calendarDay(POLICY_REVISION.day, locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  return t('policy.revised', { day })
}
