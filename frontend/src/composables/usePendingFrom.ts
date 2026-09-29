import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import type { VerdictQueue } from '@/composables/useVerdictQueue'
import { purchaseDay } from '@/days'

/**
 * The line under «N покупок ждут оценки»: «Из «Ереван Сити», последняя — вчера», «Из «A» и «B»»,
 * or «Из «A», «B» и других мест» (MOL-77) — on «Покупки» and on the newcomer's «Что брать» alike
 * (MOL-128, П-9: the handoff's «Из чека «SAS»» claims a source the queue does not know).
 *
 * By places, not trips: a card carries the moment the server took its latest purchase, and a
 * purchase made with no signal arrives with the queue hours later, so no gap tells one trip from
 * two (round 2, З1). And by names, not a count: a card carries the place's name without its city,
 * and «Ереван Сити» of Gyumri and of Yerevan are two places under one name — a number would claim
 * what the phone does not know (round 3, И2). Names are newest first. When the server holds more
 * than the page, one or two names are not claimed for all — whether there are others the phone
 * cannot tell, and says nothing (adversarial В2, round 4, Л2); three already are «and others»,
 * page or no page.
 */
export function usePendingFrom(queue: VerdictQueue): ComputedRef<string | null> {
  const { t, locale } = useI18n()
  return computed(() => {
    const cards = [...queue.cards.value].sort((a, b) => b.boughtAt.getTime() - a.boughtAt.getTime())
    const names = [...new Set(cards.map((card) => card.placeName))]
    const [a, b] = names
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
    if (names.length > 2) return t('trip.home.pending.more_places', { a, b })
    return partial ? null : t('trip.home.pending.two_places', { a, b })
  })
}
