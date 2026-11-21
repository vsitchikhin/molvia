import { describe, expect, it } from 'vitest'
import { LOCALES, SPENDING_PRESETS } from '@molvia/model'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { BOTH_LANGUAGES } from '@/i18n/bothLanguages'

const DICTIONARIES = { ru, en }

// MOL-337: the words read back in either language are the dictionaries' own, word for word.
describe('the words read back in every language', () => {
  it.each(LOCALES)('%s: the note of a check is the dictionary’s', (locale) => {
    expect(BOTH_LANGUAGES[locale].reconcileNote).toBe(DICTIONARIES[locale].accounts.reconcile.note)
  })

  it.each(LOCALES)(
    '%s: every ready-made category is named as the dictionary names it',
    (locale) => {
      expect(BOTH_LANGUAGES[locale].presets).toEqual(
        Object.fromEntries(
          SPENDING_PRESETS.map((preset) => [
            preset,
            DICTIONARIES[locale].spending.category[preset],
          ]),
        ),
      )
    },
  )
})
