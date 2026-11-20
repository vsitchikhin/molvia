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
type Messages = Record<'en' | 'en-GB' | 'en-US', typeof en> & Record<'ru', typeof ru>

type AppI18n = I18n<
  Messages,
  Record<string, unknown>,
  Record<string, unknown>,
  // `string`, not `AppLocale`: `createI18n` widens the locale it was handed, and narrowing it
  // here makes the returned value unassignable to its own declared type.
  string,
  false
>

export function createAppI18n(
  locale: AppLocale | EnglishTag = pickLocale(navigator.languages),
): AppI18n {
  // English is one dictionary under three tags (MOL-398): the tag is also what every `Intl` of a
  // screen formats by — `locale.value` — so the order of a day is the tag's, never a second
  // setting passed around. `en` stays for tests and for the moment before `installLocale`.
  return i18nOf(locale, { en, 'en-GB': en, 'en-US': en, ru })
}

/**
 * The one configuration, for the tests' i18n with both dictionaries and for the app's, which starts
 * with none and is given the one it speaks (`loadDictionary`, MOL-337). Only the tests call
 * `createAppI18n`, so the bundle holds neither dictionary: each is a chunk of its own.
 */
function i18nOf(locale: string, messages: Partial<Messages>): AppI18n {
  return createI18n({
    legacy: false,
    locale,
    // About a key that is missing, never about a person: whoever gets Russian above keeps it.
    fallbackLocale: 'en',
    messages: messages as Messages,
    pluralRules: { ru: pluralRu },
  })
}

/** The tags English is spoken under: the order of a day, British or American (MOL-398, owner's В-3). */
export type EnglishTag = 'en-GB' | 'en-US'

// Not a single string lives in the markup. The plan is to reach other languages without
// rebranding, and hardcoded text is the cheapest mistake today and the dearest one later.
// The device's language until `installLocale` (`useLocale.ts`) puts the person's choice over it — and
// no words at all until it has loaded the dictionary of that choice (MOL-337).
export const i18n = i18nOf(pickLocale(navigator.languages), {})

/** Each language's dictionary, a chunk of its own: one device speaks one (MOL-337, owner's В-3 «а»). */
const DICTIONARIES = {
  ru: () => import('@/i18n/ru.json'),
  en: () => import('@/i18n/en.json'),
} satisfies Record<AppLocale, () => Promise<{ default: unknown }>>

const loaded = new Set<AppLocale>()

/**
 * Gives the app's i18n the dictionary its tag speaks — English under every tag English is spoken under —
 * once; the next time it is there already. A failure is thrown to the caller: the words stay those of
 * the language before.
 */
export async function loadDictionary(tag: AppLocale | EnglishTag): Promise<void> {
  const language = pickLocale(tag)
  if (loaded.has(language)) return
  if (language === 'ru') {
    i18n.global.setLocaleMessage('ru', (await DICTIONARIES.ru()).default)
  } else {
    const { default: messages } = await DICTIONARIES.en()
    for (const name of ['en', 'en-GB', 'en-US'] as const)
      i18n.global.setLocaleMessage(name, messages)
  }
  loaded.add(language)
}

/**
 * The `lang` attribute is not cosmetic: hyphenation, the voice a screen reader picks and the
 * font the system falls back to all follow it. `index.html` pins it to `ru`, which is right
 * until the app boots and wrong from the moment the locale is anything else.
 *
 * Called by `useLocale.ts` — at the start from `main.ts`, and at every choice — rather than here: a
 * module that rewrites the document just because it was imported makes import order significant
 * where it normally is not, and every test that touches i18n inherits the side effect.
 */
export function applyDocumentLang(value: string): void {
  document.documentElement.lang = value
}
