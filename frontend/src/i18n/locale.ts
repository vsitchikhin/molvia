export const LOCALES = ['ru', 'en'] as const
export type AppLocale = (typeof LOCALES)[number]

/**
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
 * The whole preference list is read, not just the first entry: a phone set to Armenian with
 * English second is a different person from one set to Armenian with Russian second, and
 * `navigator.language` alone cannot tell them apart. The first tag the app actually speaks
 * wins; if it speaks none of them, Russian does.
 */
export function pickLocale(languages: string | readonly string[] | null | undefined): AppLocale {
  const list = typeof languages === 'string' ? [languages] : (languages ?? [])

  for (const tag of list) {
    // `en-nonsense` and `enm` are not English: the subtag has to end, not merely start the
    // same way. Matching by prefix alone made every tag beginning with «en» English.
    if (/^en(-|$)/i.test(tag)) return 'en'
    if (/^ru(-|$)/i.test(tag)) return 'ru'
  }

  return 'ru'
}
