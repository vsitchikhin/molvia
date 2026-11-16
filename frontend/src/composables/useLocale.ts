import { readonly, ref } from 'vue'
import type { Ref } from 'vue'
import { pickLocale } from '@molvia/model'
import type { AppLocale } from '@molvia/model'
import { applyDocumentLang, i18n } from '@/i18n'
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

function apply(): void {
  const tag = tagOf(choice.value, style.value)
  i18n.global.locale.value = tag
  applyDocumentLang(tag)
}

/**
 * Takes the stored choice before the app is mounted and follows the other windows of the app, as the
 * scheme does: the value is the event's, only this window's own shelf is brought in line with it, and
 * a key gone is no choice (`useColorScheme.ts`, adversarial А, Б′ of MOL-111). «Как на устройстве»
 * follows the device too: a language changed in the system reaches a page left open.
 */
export function installLocale(): void {
  choice.value = choiceOf(read(LOCALE_KEY))
  style.value = styleOf(read(DATE_STYLE_KEY))
  apply()
  window.addEventListener('storage', (event) => {
    if (event.newValue === null) return
    if (event.key === LOCALE_KEY) {
      choice.value = choiceOf(event.newValue)
      writeOwn(LOCALE_KEY, choice.value)
    } else if (event.key === DATE_STYLE_KEY) {
      style.value = styleOf(event.newValue)
      writeOwn(DATE_STYLE_KEY, style.value)
    } else return
    apply()
  })
  window.addEventListener('languagechange', () => {
    if (choice.value === 'device') apply()
  })
}

export function useLocale(): {
  choice: Readonly<Ref<LocaleChoice>>
  style: Readonly<Ref<DateStyle>>
  choose: (next: LocaleChoice) => void
  chooseStyle: (next: DateStyle) => void
} {
  /**
   * Every choice is written, «Как на устройстве» too, and on both shelves — for the scheme's reasons
   * (`useColorScheme.ts`). Applied whether or not it could be kept: until the page is reloaded.
   */
  function choose(next: LocaleChoice): void {
    if (next === choice.value) return
    writeEverywhere(LOCALE_KEY, next)
    choice.value = next
    apply()
  }
  function chooseStyle(next: DateStyle): void {
    if (next === style.value) return
    writeEverywhere(DATE_STYLE_KEY, next)
    style.value = next
    apply()
  }
  return {
    choice: readonly(choice),
    style: readonly(style),
    choose,
    chooseStyle,
  }
}
