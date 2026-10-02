import { computed, onMounted, onUnmounted, ref, toValue, watch } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import { ApiError } from '@molvia/client'
import { cheaperHint } from '@molvia/model'
import type {
  BaseUnit,
  CheaperHint,
  Currency,
  OwnPrices,
  OwnPricesQuery,
  SettingsGeography,
  UnitPrice,
} from '@molvia/model'
import { api } from '@/api'
import { currentIdentity } from '@/stores/identity'
import {
  forgetOwnPrices,
  recallOwnPrices,
  recallRecordCity,
  rememberOwnPrices,
  rememberRecordCity,
} from '@/stores/ownPrices'

/**
 * The record a purchase is written into, as the server can be asked about it (review №1): one it
 * holds by its id — the server reads the city off its place — and one still in the queue by the
 * city its start carries, since the server has never seen it.
 */
export type HintRecord = { readonly tripId: string } | { readonly where: SettingsGeography }

export interface CheaperHintInput {
  readonly itemId: string
  /**
   * None — no record to write into, or one with no city known — no hint. Followed, not read once:
   * on a fresh load the record going on is known only once the server has answered (e2e, review).
   */
  readonly record: MaybeRefOrGetter<HintRecord | null>
  /** The purchase the sheet amends: never compared with itself (Т-9). */
  readonly except: string | null
  /** The record's place, when the server has named it (Р-3). */
  readonly here: MaybeRefOrGetter<string | null>
  readonly typed: MaybeRefOrGetter<UnitPrice | null>
  readonly currency: MaybeRefOrGetter<Currency>
  readonly unit: MaybeRefOrGetter<BaseUnit>
}

/**
 * How long typing must pause before the hint follows it (adversarial Е). Each keystroke of «620»
 * crosses a price — «6», «62», «620» — and a line of an alternative came and went under the finger
 * with every one, moving the sheet it grows.
 */
export const HINT_SETTLE_MS = 400

const NOTHING: CheaperHint = { item: null, alternative: null }

/**
 * «Тут дешевле» on the sheet of a purchase (MOL-92): the person's own prices asked of the server
 * once, when the sheet opens, and compared with what is typed by `cheaperHint` of the domain once
 * typing pauses — the server cannot know what is being typed.
 *
 * **A hint, not a screen** (Т-5): it never shows a loading state or an error. With a signal it waits
 * for the server — a remembered answer may predate a verdict given since on another device. With
 * none, or when the connection goes while the answer is on its way — decided after the failure,
 * never from a check before it (MOL-19, adversarial А) — the last answer for this item in the
 * record's city remembered on the device (В-5); with none remembered, nothing. A refusal that is the
 * API's own word shows nothing. An amendment is never answered from memory: the remembered answer
 * may hold the very row being changed (Т-9).
 *
 * **What the server says of a verdict is heard** (adversarial Б): «не брать нигде» for this item lets
 * go of every remembered answer naming it, here as another of its kind included.
 */
export function useCheaperHint(input: CheaperHintInput): { hint: ComputedRef<CheaperHint> } {
  const owner = currentIdentity()
  const answer = ref<OwnPrices | null>(null)

  function fromMemory(record: HintRecord): void {
    if (input.except !== null) return
    const where = 'where' in record ? record.where : recallRecordCity(owner, record.tripId)
    if (where) answer.value = recallOwnPrices(owner, input.itemId, where)
  }

  function ask(record: HintRecord): void {
    if (!navigator.onLine) {
      fromMemory(record)
      return
    }
    const askedAt = Date.now()
    const query: OwnPricesQuery = {
      item: input.itemId,
      ...('tripId' in record ? { trip: record.tripId } : record.where),
      ...(input.except === null ? {} : { except: input.except }),
    }
    api
      .ownPrices(query)
      .then(({ where, prices }) => {
        if (asked !== keyOf(record)) return
        answer.value = prices
        if (owner === null) return
        if (prices.level === 'never') forgetOwnPrices(owner, [prices.itemId])
        if (!where) return
        if ('tripId' in record) rememberRecordCity(owner, record.tripId, where)
        if (input.except === null) rememberOwnPrices(owner, input.itemId, where, prices, askedAt)
      })
      .catch((error: unknown) => {
        // The API's own refusal is an answer: there is nothing to show. A connection that did not
        // carry one is a shelf with no signal, whatever `onLine` said before the request.
        if (asked !== keyOf(record) || (error instanceof ApiError && error.answered)) return
        fromMemory(record)
      })
  }

  // Asked once per record: the record a queued start becomes on the server is another question.
  let asked: string | null = null
  const keyOf = (record: HintRecord) =>
    'tripId' in record ? record.tripId : `${record.where.country}|${record.where.city}`
  onMounted(() => {
    watch(
      () => toValue(input.record),
      (record) => {
        if (!record || keyOf(record) === asked) return
        asked = keyOf(record)
        ask(record)
      },
      { immediate: true },
    )
  })

  // The typed price the hint follows, once typing pauses.
  const settled = ref<UnitPrice | null>(toValue(input.typed))
  let pause: ReturnType<typeof setTimeout> | undefined
  watch(
    () => toValue(input.typed),
    (typed) => {
      clearTimeout(pause)
      pause = setTimeout(() => {
        settled.value = typed
      }, HINT_SETTLE_MS)
    },
  )
  onUnmounted(() => {
    clearTimeout(pause)
  })

  const hint = computed(() => {
    const known = answer.value
    if (!known) return NOTHING
    return cheaperHint({
      answer: known,
      currency: toValue(input.currency),
      unit: toValue(input.unit),
      typed: settled.value,
      here: toValue(input.here),
    })
  })
  return { hint }
}
