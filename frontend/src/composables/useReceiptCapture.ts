import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { modelAlone, photoReceiptCountrySchema, receiptCountrySchema } from '@molvia/model'
import type { PhotoReceiptCountry, ReceiptCountry } from '@molvia/model'
import { useReceiptsAccess } from '@/composables/useReceiptsAccess'
import { useActorStore } from '@/stores/actor'

/**
 * Whether this person takes receipts — the version «с чеком» of «Что брать» and «Покупки» (handoff
 * v2, Д-3) — and the country they are read in. **By the country of the settings, against the
 * countries the server reads** (Р-1): a receipt of any other is refused by the schema, and a button
 * that always ends in «не принят» is worse than none. **A country the model alone reads, Georgia, only for whom it
 * reads** (`modelAlone`, MOL-408, owner's В-2 «а»): its receipt would fail as unreadable for anyone else, so
 * `/actors/me` must have said `receiptsByModel` — not yet said, none. **Or that its tariff is closed** (MOL-276, owner's
 * В-2 «а»): the button stays, and its tap says why in «Пробные чеки закончились», with the record by hand — the button
 * gone after the tenth receipt said nothing. A share or a cap spent still takes it away: the server does not say them.
 */
export function useReceiptCapture(): {
  /**
   * The country of the settings when the server reads its receipts — by photo (Armenia) or by the
   * link of the QR code the phone reads off the photo (Serbia, MOL-233): «Сфотографировать чек» either way.
   */
  readonly country: ComputedRef<ReceiptCountry | null>
  /**
   * The same country only where somebody reads the receipt shot there (adversarial А5): not with the tariff closed and
   * nobody in the model's place — the фф `payments` on, or Georgia. What the screens promise of a receipt — «Molvia
   * прочитает чек» — goes by it; the camera and its strip by `country`.
   */
  readonly readCountry: ComputedRef<ReceiptCountry | null>
  /**
   * The country when its receipts are read off the photo itself: «Переснять» is its alone — and only where they are
   * read, never Georgia's with its tariff closed, where a new shot is read by nobody.
   */
  readonly photoCountry: ComputedRef<PhotoReceiptCountry | null>
} {
  const actor = useActorStore()
  // whether the tariff is closed is `useReceiptsAccess`'s alone (review №4)
  const { closed, othersRead } = useReceiptsAccess()
  const settled = computed(() => {
    const parsed = receiptCountrySchema.safeParse(actor.settings?.country)
    return parsed.success ? parsed.data : null
  })
  const reads = computed(() => {
    if (settled.value === null || !modelAlone(settled.value)) return settled.value
    return actor.actor?.receiptsByModel === true ? settled.value : null
  })
  const country = computed(() => {
    if (reads.value !== null || settled.value === null) return reads.value
    return closed.value ? settled.value : null
  })
  return {
    country,
    readCountry: computed(() => (closed.value && !othersRead.value ? null : country.value)),
    photoCountry: computed(() => {
      const parsed = photoReceiptCountrySchema.safeParse(reads.value)
      return parsed.success ? parsed.data : null
    }),
  }
}
