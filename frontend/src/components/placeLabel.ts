/** What a translator has to be able to do here — `useI18n()`'s `t` and `te`, and nothing more. */
interface Words {
  t: (key: string, named: Record<string, unknown>) => string
  te: (key: string) => boolean
}

/**
 * «Ереван Сити в Гюмри» — a place named with its city, or its name alone where `city` is `null`
 * (MOL-120). Whether a city is printed at all is the domain's `cityWhereNameRepeats`; this is only
 * how it reads. Russian wants the prepositional case, so the city is a key of `place.cities_in`;
 * one the dictionary does not hold — a city typed before the settings offered a list — is put in
 * brackets rather than declined by guess.
 */
export function placeLabel(name: string, city: string | null, words: Words): string {
  if (city === null) return name
  const key = `place.cities_in.${city}`
  return words.te(key)
    ? words.t('place.in_city', { place: name, where: words.t(key, {}) })
    : words.t('place.in_unknown_city', { place: name, city })
}
