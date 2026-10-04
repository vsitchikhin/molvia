import { ref } from 'vue'
import type { Ref } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR, receiptDetailCodec } from '@molvia/model'
import type { ReceiptDetail } from '@molvia/model'
import { api } from '@/api'
import { useKeptAnswer } from '@/composables/useKeptAnswer'
import type { KeptAnswer } from '@/composables/useKeptAnswer'

/** How many receipts the phone keeps for the review offline: the newest read. */
const RECEIPTS_KEPT = 8

/**
 * One receipt for the review (MOL-127, Т-7, Т-9): the server's, kept on the phone so the review opens
 * with no connection — «Без связи · чек из памяти телефона». `gone` — the server says there is no such
 * receipt for this person: removed on another phone, or recorded and its purchases removed since
 * (handoff v1, question 5), never «offline» or «error».
 */
export function useReceipt(id: Ref<string>): KeptAnswer<ReceiptDetail> & { gone: Ref<boolean> } {
  const gone = ref(false)
  const kept = useKeptAnswer({
    key: 'molvia.receipt',
    subject: id,
    ask: async (asked) => {
      try {
        const answer = await api.receipt(asked, { shown: document.visibilityState === 'visible' })
        gone.value = false
        return answer
      } catch (error) {
        if (error instanceof ApiError && error.answered && error.code === ERROR.NOT_FOUND)
          gone.value = true
        throw error
      }
    },
    codec: receiptDetailCodec,
    kept: RECEIPTS_KEPT,
  })
  return { ...kept, gone }
}
