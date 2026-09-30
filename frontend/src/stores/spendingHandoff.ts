import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { SPENDING_TEXT_MAX } from '@molvia/model'

/**
 * «Записать тратой в «Деньгах»» (MOL-78, owner's decision В-1): a record with no purchases is not
 * where a sum goes — money without purchases is a spending — so the record is removed and «Деньги»
 * open the sheet of a spending with the shop and the day already there, in «Продукты». This is what
 * travels between the two screens, once: kept in memory, taken by the screen that opens the sheet.
 */
export interface SpendingPrefill {
  readonly place: string
  readonly day: string
}

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export const useSpendingHandoffStore = defineStore('spendingHandoff', () => {
  const handed = shallowRef<SpendingPrefill | null>(null)

  /**
   * A shop's name may be 200 characters and «Где» of a spending holds 80: cut here, never inside what
   * is drawn as one character — an emoji, a flag — so the sheet can save what it filled in itself — the record is already
   * removed by then, and «символы, которые нельзя сохранить» said nothing about length (review В).
   */
  function hand(prefill: SpendingPrefill): void {
    const place = Array.from(GRAPHEMES.segment(prefill.place), (part) => part.segment)
    while (place.join('').length > SPENDING_TEXT_MAX) place.pop()
    handed.value = { ...prefill, place: place.join('').trim() }
  }

  function take(): SpendingPrefill | null {
    const prefill = handed.value
    handed.value = null
    return prefill
  }

  return { handed, hand, take }
})
