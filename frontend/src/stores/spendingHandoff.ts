import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

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

export const useSpendingHandoffStore = defineStore('spendingHandoff', () => {
  const handed = shallowRef<SpendingPrefill | null>(null)

  function hand(prefill: SpendingPrefill): void {
    handed.value = prefill
  }

  function take(): SpendingPrefill | null {
    const prefill = handed.value
    handed.value = null
    return prefill
  }

  return { handed, hand, take }
})
