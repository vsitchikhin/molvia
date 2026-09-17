import { createI18n } from 'vue-i18n'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { pickLocale } from '@/i18n/locale'
import { pluralRu } from '@/i18n/plural-ru'

// Not a single string lives in the markup. The plan is to reach other languages without
// rebranding, and hardcoded text is the cheapest mistake today and the dearest one later.
export const locale = pickLocale(navigator.language)

export const i18n = createI18n({
  legacy: false,
  locale,
  // About a key that is missing, never about a person: whoever gets Russian above keeps it.
  fallbackLocale: 'en',
  messages: { en, ru },
  pluralRules: { ru: pluralRu },
})

/**
 * The `lang` attribute is not cosmetic: hyphenation, the voice a screen reader picks and the
 * font the system falls back to all follow it. `index.html` pins it to `ru`, which is right
 * until the app boots and wrong from the moment the locale is anything else.
 */
export function applyDocumentLang(value: string = locale): void {
  document.documentElement.lang = value
}

applyDocumentLang()
