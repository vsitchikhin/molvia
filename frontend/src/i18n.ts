import { createI18n } from 'vue-i18n'
import type { I18n } from 'vue-i18n'
import { pickLocale } from '@molvia/model'
import type { AppLocale } from '@molvia/model'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { pluralRu } from '@/i18n/plural-ru'

/**
 * One place that knows how this app's i18n is configured — and tests build theirs through it
 * too.
 *
 * Handwritten `createI18n` calls in tests drifted from production in two ways that matter:
 * without `pluralRules` a Russian counter answered «2 позиций» in the test and «2 позиции» in
 * the app, and without `fallbackLocale` a missing key printed its own name instead of the
 * English text. Both mean a test can only ever confirm behaviour nobody ships.
 */
/**
 * What the factory returns: the composition-API shape, spelled out once.
 *
 * `createI18n` derives its result from the *object* it is handed — `(typeof options)['legacy']
 * extends false` — not from a generic argument. So `ReturnType<typeof createI18n>` collapses
 * to «legacy or composition», and on that union `t()` has no callable signature left: every
 * `createAppI18n(...).global.t(...)` stops compiling. Naming `I18n<…, false>` picks the branch
 * the options actually select, and satisfies the linter's demand for an explicit return type.
 */
type AppI18n = I18n<
  { en: typeof en; ru: typeof ru },
  Record<string, unknown>,
  Record<string, unknown>,
  // `string`, not `AppLocale`: `createI18n` widens the locale it was handed, and narrowing it
  // here makes the returned value unassignable to its own declared type.
  string,
  false
>

export function createAppI18n(locale: AppLocale = pickLocale(navigator.languages)): AppI18n {
  return createI18n({
    legacy: false,
    locale,
    // About a key that is missing, never about a person: whoever gets Russian above keeps it.
    fallbackLocale: 'en',
    messages: { en, ru },
    pluralRules: { ru: pluralRu },
  })
}

// Not a single string lives in the markup. The plan is to reach other languages without
// rebranding, and hardcoded text is the cheapest mistake today and the dearest one later.
export const locale = pickLocale(navigator.languages)

export const i18n = createAppI18n(locale)

/**
 * The `lang` attribute is not cosmetic: hyphenation, the voice a screen reader picks and the
 * font the system falls back to all follow it. `index.html` pins it to `ru`, which is right
 * until the app boots and wrong from the moment the locale is anything else.
 *
 * Called from `main.ts` rather than here: a module that rewrites the document just because it
 * was imported makes import order significant where it normally is not, and every test that
 * touches i18n inherits the side effect.
 */
export function applyDocumentLang(value: string = locale): void {
  document.documentElement.lang = value
}
