import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { receiptCountrySchema } from '@molvia/model'
import type { ReceiptCountry } from '@molvia/model'
import { useActorStore } from '@/stores/actor'

/**
 * Whether this person takes receipts — the version «с чеком» of «Что брать» and «Покупки» (handoff
 * v2, Д-3) — and the country they are read in. **By the country of the settings, against the
 * countries the server reads** (Р-1): a receipt of any other is refused by the schema, and a button
 * that always ends in «не принят» is worse than none. No flag: the rule is the model's list.
 */
export function useReceiptCapture(): { readonly country: ComputedRef<ReceiptCountry | null> } {
  const actor = useActorStore()
  return {
    country: computed(() => {
      const parsed = receiptCountrySchema.safeParse(actor.settings?.country)
      return parsed.success ? parsed.data : null
    }),
  }
}
