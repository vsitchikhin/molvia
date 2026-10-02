import { computed, onMounted, ref, toValue } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import { cheaperHint } from '@molvia/model'
import type {
  BaseUnit,
  CheaperHint,
  Currency,
  OwnPricesResponse,
  SettingsGeography,
  UnitPrice,
} from '@molvia/model'
import { api } from '@/api'
import { currentIdentity } from '@/stores/identity'
import { recallOwnPrices, rememberOwnPrices } from '@/stores/ownPrices'

export interface CheaperHintInput {
  readonly itemId: string
  /** The record's country and city (В-4); none known — no hint. */
  readonly where: SettingsGeography | null
  /** The purchase the sheet amends: never compared with itself (Т-9). */
  readonly except: string | null
  /** The record's place, when the server has named it (Р-3). */
  readonly here: MaybeRefOrGetter<string | null>
  readonly typed: MaybeRefOrGetter<UnitPrice | null>
  readonly currency: MaybeRefOrGetter<Currency>
  readonly unit: MaybeRefOrGetter<BaseUnit>
}

const NOTHING: CheaperHint = { item: null, alternative: null }

/**
 * «Тут дешевле» on the sheet of a purchase (MOL-92): the person's own prices asked of the server
 * once, when the sheet opens, and compared with what is typed by `cheaperHint` of the domain on
 * every keystroke — the server cannot know what is being typed.
 *
 * **A hint, not a screen** (Т-5): it never shows a loading state or an error. With no signal, the
 * last answer for this item in this city remembered on the device; with none remembered, nothing
 * (В-5). A failed request shows nothing. An amendment is never answered from memory: the
 * remembered answer may hold the very row being changed, and a row compared with itself says
 * «как в …» about itself (Т-9).
 */
export function useCheaperHint(input: CheaperHintInput): { hint: ComputedRef<CheaperHint> } {
  const owner = currentIdentity()
  const where = input.where
  const answer = ref<OwnPricesResponse | null>(null)

  onMounted(() => {
    if (!where) return
    // Memory is for no signal, not instead of asking: with one, the hint waits for the server's
    // answer — a remembered one may predate a verdict given since on another device.
    if (!navigator.onLine) {
      if (input.except === null) answer.value = recallOwnPrices(owner, input.itemId, where)
      return
    }
    const query = {
      item: input.itemId,
      country: where.country,
      city: where.city,
      ...(input.except === null ? {} : { except: input.except }),
    }
    api
      .ownPrices(query)
      .then((fresh) => {
        answer.value = fresh
        if (owner !== null && input.except === null) {
          rememberOwnPrices(owner, input.itemId, where, fresh)
        }
      })
      .catch(() => undefined)
  })

  const hint = computed(() => {
    const known = answer.value
    if (!known) return NOTHING
    return cheaperHint({
      answer: known,
      currency: toValue(input.currency),
      unit: toValue(input.unit),
      typed: toValue(input.typed),
      here: toValue(input.here),
    })
  })
  return { hint }
}
