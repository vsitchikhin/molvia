import { readonly, ref } from 'vue'
import type { Ref } from 'vue'
import { pickLocale } from '@molvia/model'
import type { AppLocale } from '@molvia/model'
import { applyDocumentLang, i18n, loadDictionary } from '@/i18n'
import type { EnglishTag } from '@/i18n'
import { read, writeEverywhere, writeOwn } from '@/stores/storage'

/**
 * The language this device speaks (MOL-398): the device's own, by `pickLocale` as before, or one the
 * person chose. A property of the device, as the scheme is (MOL-111) — kept here, left in place by
 * «Выйти» and by erasure — though the account hears it too: every request names it
 * (`LOCALE_HEADER`), so the bot's reminder speaks it.
 */
export type LocaleChoice = 'device' | AppLocale

/** The order of an English day (owner's В-3 «б»): British by default, American by choice. */
export type DateStyle = 'gb' | 'us'

export const LOCALE_KEY = 'molvia.locale'
export const DATE_STYLE_KEY = 'molvia.date-style'

/** Anything but the two — nothing, an old or foreign value — is the device's language. */
function choiceOf(value: string | null): LocaleChoice {
  return value === 'ru' || value === 'en' ? value : 'device'
}

function styleOf(value: string | null): DateStyle {
  return value === 'us' ? 'us' : 'gb'
}

/**
 * The tag the screens speak and format by: `ru`, or English with the order of its day. One tag rather
 * than a language and a format beside it — every `Intl` of a screen already takes `locale.value`.
 */
export function tagOf(
  choice: LocaleChoice,
  style: DateStyle,
  languages: readonly string[] = navigator.languages,
): AppLocale | EnglishTag {
  const language = choice === 'device' ? pickLocale(languages) : choice
  if (language === 'ru') return 'ru'
  return style === 'us' ? 'en-US' : 'en-GB'
}

const choice = ref<LocaleChoice>('device')
const style = ref<DateStyle>('gb')

/** How long the start waits before it asks for its dictionary again, with no `online` to wait for. */
export const DICTIONARY_RETRY_MS = 5 * 1000

let turn = 0
/** The turn of the last choice spoken. */
let spokenTurn = 0

/**
 * Speaks the choice once its dictionary is here (MOL-337): the words never change before the words to
 * change to have come. Says whether it was spoken — a dictionary that did not come leaves the language
 * before, and of two choices made while one was coming only the later one is spoken.
 */
async function speak(nextChoice: LocaleChoice, nextStyle: DateStyle): Promise<boolean> {
  const mine = ++turn
  const tag = tagOf(nextChoice, nextStyle)
  try {
    await loadDictionary(tag)
  } catch {
    return false
  }
  if (mine !== turn) return false
  spokenTurn = mine
  choice.value = nextChoice
  style.value = nextStyle
  i18n.global.locale.value = tag
  applyDocumentLang(tag)
  return true
}

/**
 * Takes the stored choice and its dictionary before the app is mounted, and follows the other windows of
 * the app, as the scheme does: the value is the event's, only this window's own shelf is brought in line
 * with it, and a key gone is no choice (`useColorScheme.ts`, adversarial А, Б′ of MOL-111). «Как на
 * устройстве» follows the device too: a language changed in the system reaches a page left open.
 *
 * The promise is the start's: it settles once the first dictionary is here. Without it nothing can be
 * said, so it is asked for again — when the connection comes back, or every `DICTIONARY_RETRY_MS`.
 */
export async function installLocale(): Promise<void> {
  const stored = choiceOf(read(LOCALE_KEY))
  const storedStyle = styleOf(read(DATE_STYLE_KEY))
  window.addEventListener('storage', (event) => {
    if (event.newValue === null) return
    if (event.key === LOCALE_KEY) {
      const next = choiceOf(event.newValue)
      writeOwn(LOCALE_KEY, next)
      void speak(next, style.value)
    } else if (event.key === DATE_STYLE_KEY) {
      const next = styleOf(event.newValue)
      writeOwn(DATE_STYLE_KEY, next)
      void speak(choice.value, next)
    }
  })
  window.addEventListener('languagechange', () => {
    if (choice.value === 'device') void speak('device', style.value)
  })
  // A choice made meanwhile — here or in another window — is spoken instead, and the start is over.
  const since = turn
  while (!(await speak(stored, storedStyle)) && spokenTurn <= since) {
    await new Promise<void>((retry) => {
      const timer = setTimeout(retry, DICTIONARY_RETRY_MS)
      window.addEventListener(
        'online',
        () => {
          clearTimeout(timer)
          retry()
        },
        { once: true },
      )
    })
  }
}

export function useLocale(): {
  choice: Readonly<Ref<LocaleChoice>>
  style: Readonly<Ref<DateStyle>>
  choose: (next: LocaleChoice) => Promise<void>
  chooseStyle: (next: DateStyle) => Promise<void>
} {
  /**
   * Every choice is written, «Как на устройстве» too, and on both shelves — for the scheme's reasons
   * (`useColorScheme.ts`) — once its dictionary is here: one that did not come is no choice, and the
   * language stays (MOL-337). Spoken whether or not it could be kept: until the page is reloaded.
   */
  async function choose(next: LocaleChoice): Promise<void> {
    if (next === choice.value) return
    if (await speak(next, style.value)) writeEverywhere(LOCALE_KEY, next)
  }
  async function chooseStyle(next: DateStyle): Promise<void> {
    if (next === style.value) return
    if (await speak(choice.value, next)) writeEverywhere(DATE_STYLE_KEY, next)
  }
  return {
    choice: readonly(choice),
    style: readonly(style),
    choose,
    chooseStyle,
  }
}
