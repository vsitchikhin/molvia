import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { cityWhereNameRepeats, placeNameIdentity } from '@molvia/model'
import type { PendingVerdict } from '@molvia/model'
import { placeLabel } from '@/components/placeLabel'
import type { VerdictQueue } from '@/composables/useVerdictQueue'
import { purchaseDay } from '@/days'

const placeOfCard = (card: PendingVerdict) => ({ name: card.placeName, city: card.placeCity })

/**
 * The line under «N покупок ждут оценки»: «Из «Ереван Сити», последняя — вчера», «Из «A» и «B»»,
 * or «Из «A», «B» и других мест» (MOL-77) — on «Покупки» and on the newcomer's «Что брать» alike
 * (MOL-128, П-9: the handoff's «Из чека «SAS»» claims a source the queue does not know).
 *
 * By places, not trips: a card carries the moment the server took its latest purchase, and a
 * purchase made with no signal arrives with the queue hours later, so no gap tells one trip from
 * two (round 2, З1). And by names, not a count (round 3, И2): a number would claim more than the
 * line needs to say. A place is its name and, where that name stands in two cities, its city —
 * «Из «Ереван Сити» в Гюмри и «Ереван Сити» в Ереване» (MOL-120); a card from before the city
 * travelled leaves every name as it was (`cityWhereNameRepeats`). Names are newest first. When the
 * server holds more than the page, one or two places are not claimed for all — whether there are
 * others the phone cannot tell, and says nothing (adversarial В2, round 4, Л2); three already are
 * «and others», page or no page.
 */
export function usePendingFrom(queue: VerdictQueue): ComputedRef<string | null> {
  const i18n = useI18n()
  const { t, locale } = i18n
  return computed(() => {
    const cards = [...queue.cards.value].sort((a, b) => b.boughtAt.getTime() - a.boughtAt.getTime())
    const cityOf = cityWhereNameRepeats(cards.map(placeOfCard))
    const places = new Map<string, string>()
    for (const card of cards) {
      const city = cityOf(placeOfCard(card))
      const key = JSON.stringify([
        placeNameIdentity(card.placeName),
        city === null ? null : placeNameIdentity(city),
      ])
      if (places.has(key)) continue
      const quoted = t('trip.home.pending.place', { place: card.placeName })
      places.set(key, placeLabel(quoted, city, i18n))
    }
    const [a, b] = places.values()
    const partial = queue.count.value > cards.length
    if (a === undefined) return null
    if (b === undefined) {
      const [latest] = cards
      return partial || !latest
        ? null
        : t('trip.home.pending.one_place', {
            place: a,
            when: purchaseDay(latest.boughtAt, locale.value),
          })
    }
    if (places.size > 2) return t('trip.home.pending.more_places', { a, b })
    return partial ? null : t('trip.home.pending.two_places', { a, b })
  })
}
