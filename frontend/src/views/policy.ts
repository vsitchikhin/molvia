import { calendarDay } from '@/days'

/**
 * The revision of «Условия использования» and «Данные и приватность» (MOL-95, owner's decision В-1):
 * the day both pages say they were last edited, and the fingerprint of their text in every language
 * on that day, with the lists of the parts each shows. **Any edit of either page is a new revision**, and `policy.test.ts` will not let the
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
  digest: '40f4beececbc44d8417f1ac739ba848e4c290e393584f24604d9f5b85354c69d',
} as const

// Which parts each page shows, in order — here and not in the pages, so the fingerprint holds them
// too (review №5): a part taken out of a list is a page changed with every word of the dictionary
// still in place.

/** «Что мы храним», in the order of how personal it is: the account, then what it did. */
export const PRIVACY_STORED = [
  'telegram',
  'purchases',
  'exchanges',
  'incomes',
  'spendings',
  'receipts',
  'accounts',
  'places',
  'barcodes',
  'ratings',
  'reminders',
  'feedback',
  'search',
  'visits',
  'devices',
  'settings',
  'consent',
] as const
export const PRIVACY_PARTS = [
  'logs',
  'failures',
  'backups',
  'barcodes',
  'storage',
  'copy',
  'erase',
] as const
export const TERMS_PARTS = [
  'what',
  'who',
  'yours',
  'write',
  'catalogue',
  'ads',
  'warranty',
  'free',
  'changes',
  'contact',
] as const

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
