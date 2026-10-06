import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { linkReceiptCountrySchema, photoReceiptCountrySchema } from '@molvia/model'
import type { LinkReceiptCountry, PhotoReceiptCountry } from '@molvia/model'
import { useActorStore } from '@/stores/actor'

/**
 * Whether this person takes receipts — the version «с чеком» of «Что брать» and «Покупки» (handoff
 * v2, Д-3) — and the country they are read in. **By the country of the settings, against the
 * countries the server reads** (Р-1): a receipt of any other is refused by the schema, and a button
 * that always ends in «не принят» is worse than none. No flag: the rule is the model's list.
 */
export function useReceiptCapture(): {
  readonly country: ComputedRef<PhotoReceiptCountry | null>
  /**
   * The country of the settings when its receipts come by the link of their QR code — Serbia
   * (MOL-232): «Покупки» offer «Чек по ссылке» beside «Записать вручную»; every other screen keeps
   * the version «без чека» until the camera reads the code (MOL-233).
   */
  readonly linkCountry: ComputedRef<LinkReceiptCountry | null>
} {
  const actor = useActorStore()
  return {
    country: computed(() => {
      const parsed = photoReceiptCountrySchema.safeParse(actor.settings?.country)
      return parsed.success ? parsed.data : null
    }),
    linkCountry: computed(() => {
      const parsed = linkReceiptCountrySchema.safeParse(actor.settings?.country)
      return parsed.success ? parsed.data : null
    }),
  }
}
