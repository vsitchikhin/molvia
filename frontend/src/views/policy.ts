import { calendarDay } from '@/days'

/**
 * The revision of «Условия использования» and «Данные и приватность» (MOL-95, owner's decision В-1):
 * the day both pages say they were last edited, and the fingerprint of their text in every language
 * on that day, with the lists of the parts each shows and the templates that draw them. **Any edit
 * of either page is a new revision**, and `policy.test.ts` will not let the text change without one
 * — so nothing on them changes in silence.
 *
 * **A revision is not an edition.** The edition a person accepts is `POLICY_VERSION` of the model,
 * raised by hand only for a change that matters — a new kind of data, a new recipient, a new purpose,
 * a change of the terms — and only that puts everybody through the consent screen again. A line added
 * to the privacy page by a task about data moves the day and the fingerprint alone. `version` is
 * written here too, so raising the edition is an edit of this file and of the day.
 */
export const POLICY_REVISION = {
  day: '2026-10-08',
  version: 2,
  digest: '5743d906b4f83310f64e37d32310b23e7c59691f0f28bf8937c8d9c48ef218b1',
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
/** Who the data goes to (MOL-236): a new recipient is a line here and a new edition. */
export const PRIVACY_RECIPIENTS = [
  'people',
  'telegram',
  'contabo',
  'cloudflare',
  'open_food_facts',
  'serbian_tax',
  'nobody',
] as const

/**
 * The parts of «Данные и приватность», in order. Two of them are lists, drawn as cards of terms
 * (`PRIVACY_LISTS`); the rest are a title and a text. The basis stands right after the list of what
 * is kept, since art. 10 of Armenia's law asks of them together (MOL-236); the rights, the
 * authorities and a breach close the page — what is looked for when something went wrong.
 */
export const PRIVACY_PARTS = [
  'operator',
  'stored',
  'bases',
  'statistics',
  'recipients',
  'logs',
  'failures',
  'backups',
  'barcodes',
  'serbian_receipts',
  'storage',
  'copy',
  'erase',
  'inactive',
  'rights',
  'complaints',
  'breach',
] as const
export const PRIVACY_LISTS: Partial<Record<(typeof PRIVACY_PARTS)[number], readonly string[]>> = {
  stored: PRIVACY_STORED,
  recipients: PRIVACY_RECIPIENTS,
}
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

/**
 * «Редакция 2 от 7 октября 2026 г.» — the subtitle of both pages. The edition is named beside the day
 * (MOL-236, adversarial Р4-А1): two editions may be revised on one day, and the day alone would put one
 * subtitle over two texts a person was asked to accept.
 */
export function revisedOn(
  t: (key: string, values: Record<string, string>) => string,
  locale: string,
): string {
  const day = calendarDay(POLICY_REVISION.day, locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  return t('policy.revised', { version: String(POLICY_REVISION.version), day })
}
