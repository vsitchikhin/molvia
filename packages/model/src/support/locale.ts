export const LOCALES = ['ru', 'en'] as const
export type AppLocale = (typeof LOCALES)[number]

/**
 * Which language a person is shown, from whatever tag the platform hands us — in one place.
 *
 * It lived in the PWA until MOL-55, when the bot needed the same rule: Telegram's
 * `language_code` is the same kind of IETF tag as `navigator.languages`, and a second copy of
 * this decision would have been a second place to drift — the way `INVISIBLE` and the resource
 * identifier both drifted before they were brought together.
 *
 * Russian is the default and English is the exception — deliberately, and not the other way
 * round.
 *
 * The first market is the Russian-speaking diaspora in Gyumri and Yerevan. A phone bought in
 * Armenia arrives as `hy-AM`, one set up once anywhere else as `en-US`, and the earlier rule
 * («is it ru? otherwise English») showed both of those people a language the product is not
 * written in. There is no English-speaking audience in 0.1 at all: six people, all
 * Russian-speaking.
 *
 * A missing or unknown language is Russian too, for the same reason — this is not a guess
 * about the world, it is a guess about who opens this app.
 *
 * **Only the first tag is read, deliberately.** Walking the whole preference list looks more
 * thoughtful and quietly reverses this decision: Android and iOS append `en-US` themselves
 * when the system language is not English, so a phone set to Armenian arrives as
 * `['hy-AM', 'en-US']`. Taking the first tag the app understands hands English to exactly the
 * person this rule exists for — and does so even when Russian is in the list, merely lower.
 * The list cannot separate «an Armenian who reads English» from «a Russian speaker in
 * Gyumri», because English gets there without anyone choosing it.
 *
 * The asymmetry decides: showing Russian to someone who would prefer English is an
 * inconvenience; showing English to all six users of 0.1 is the product in a language it is
 * not written in.
 */
export function pickLocale(languages: string | readonly string[] | null | undefined): AppLocale {
  const first = typeof languages === 'string' ? languages : (languages?.[0] ?? '')

  // `enm` (Middle English) and `en-nonsense` are not English: the subtag has to end, not
  // merely start the same way. Matching by prefix alone made every tag beginning with «en»
  // English. Underscores are accepted because system layers sometimes write `en_US`.
  return /^en([-_]|$)/i.test(first) ? 'en' : 'ru'
}
