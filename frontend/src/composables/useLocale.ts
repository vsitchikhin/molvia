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

/**
 * What is asked for: the person's last choice, or the device's, shown at once — a group of segments stands on
 * it — and spoken once its dictionary is here (MOL-337). A dictionary that did not come gives back what was
 * spoken, the choice shown with it (adversarial А3).
 */
const choice = ref<LocaleChoice>('device')
const style = ref<DateStyle>('gb')

/** How long the start waits before it asks for its dictionary again, with no `online` to wait for. */
export const DICTIONARY_RETRY_MS = 5 * 1000

/** What the screens speak; none before the first dictionary came. */
let spoken: { choice: LocaleChoice; style: DateStyle } | null = null
let turn = 0
/** The turn of the last choice spoken. */
let spokenTurn = 0

/**
 * Speaks what is asked for once its dictionary is here (MOL-337): the words never change before the words to
 * change to have come. Says how it ended — `failed` only while nothing was asked since: of two asked while a
 * dictionary was coming only the later is spoken, whatever came first (adversarial А2); one that did not come
 * leaves the language spoken before.
 */
async function speak(): Promise<'spoken' | 'failed' | 'superseded'> {
  const mine = ++turn
  const asked = { choice: choice.value, style: style.value }
  const tag = tagOf(asked.choice, asked.style)
  try {
    await loadDictionary(tag)
  } catch {
    return mine === turn ? 'failed' : 'superseded'
  }
  if (mine !== turn) return 'superseded'
  spoken = asked
  spokenTurn = mine
  i18n.global.locale.value = tag
  applyDocumentLang(tag)
  return 'spoken'
}

/**
 * A tap whose dictionary did not come gives back the choice spoken: the group of segments stands on what is
 * asked for, and «English» stayed chosen over Russian words (adversarial А3).
 */
async function speakChosen(): Promise<boolean> {
  const outcome = await speak()
  if (outcome === 'failed' && spoken !== null) {
    choice.value = spoken.choice
    style.value = spoken.style
  }
  return outcome === 'spoken'
}

/** The next try at the start's dictionary: the connection back, or a while — whichever comes first. */
function nextTry(): Promise<void> {
  return new Promise((retry) => {
    const done = new AbortController()
    const timer = setTimeout(() => {
      done.abort()
    }, DICTIONARY_RETRY_MS)
    window.addEventListener(
      'online',
      () => {
        done.abort()
      },
      { signal: done.signal },
    )
    done.signal.addEventListener('abort', () => {
      clearTimeout(timer)
      retry()
    })
  })
}

/**
 * Takes the stored choice and its dictionary before the app is mounted, and follows the other windows of
 * the app, as the scheme does: the value is the event's, only this window's own shelf is brought in line
 * with it, and a key gone is no choice (`useColorScheme.ts`, adversarial А, Б′ of MOL-111). «Как на
 * устройстве» follows the device too: a language changed in the system reaches a page left open.
 *
 * The promise is the start's: it settles once the first dictionary is here. Without it nothing can be
 * said, so it is asked for again — when the connection comes back, or every `DICTIONARY_RETRY_MS`. **The
 * price, named** (adversarial А8): a request that neither answers nor fails holds the start until the
 * browser gives it up — the same `import()` asked again would wait on the same request.
 */
export async function installLocale(): Promise<void> {
  // Asked for at once, so another window's half of a choice keeps this one's other half (adversarial А7).
  choice.value = choiceOf(read(LOCALE_KEY))
  style.value = styleOf(read(DATE_STYLE_KEY))
  window.addEventListener('storage', (event) => {
    if (event.newValue === null) return
    if (event.key === LOCALE_KEY) {
      choice.value = choiceOf(event.newValue)
      writeOwn(LOCALE_KEY, choice.value)
    } else if (event.key === DATE_STYLE_KEY) {
      style.value = styleOf(event.newValue)
      writeOwn(DATE_STYLE_KEY, style.value)
    } else return
    void speak()
  })
  window.addEventListener('languagechange', () => {
    if (choice.value === 'device') void speak()
  })
  // A choice spoken meanwhile — here or in another window — ends the start: asked before each try, never after;
  // only a dictionary that did not come waits for the next try, one overtaken asks again at once.
  const since = turn
  while (spokenTurn <= since) {
    const outcome = await speak()
    if (outcome === 'spoken') return
    if (outcome === 'failed') await nextTry()
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
   * (`useColorScheme.ts`) — once it is spoken: one whose dictionary did not come is no choice, and one made
   * after it takes its place (MOL-337). Spoken whether or not it could be kept: until the page is reloaded.
   */
  async function choose(next: LocaleChoice): Promise<void> {
    if (next === choice.value) return
    choice.value = next
    if (await speakChosen()) writeEverywhere(LOCALE_KEY, next)
  }
  async function chooseStyle(next: DateStyle): Promise<void> {
    if (next === style.value) return
    style.value = next
    if (await speakChosen()) writeEverywhere(DATE_STYLE_KEY, next)
  }
  return {
    choice: readonly(choice),
    style: readonly(style),
    choose,
    chooseStyle,
  }
}
