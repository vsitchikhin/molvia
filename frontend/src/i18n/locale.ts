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
 */
export function pickLocale(language: string | null | undefined): AppLocale {
  return language?.toLowerCase().startsWith('en') ? 'en' : 'ru'
}
