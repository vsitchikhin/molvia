import { ref } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { TransferOutcome } from '@/components/TransferSheet.vue'
import { asTyped } from '@/components/spending'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useTransfers } from '@/composables/useTransfers'
import { useAccountsStore } from '@/stores/accounts'

export interface TransferOutcomes {
  /** The transfer just removed, offered back for the strip's ten seconds (Р-8). */
  readonly removed: Ref<{ readonly id: string; readonly stamp: number } | null>
  readonly done: (outcome: TransferOutcome) => void
  readonly restore: () => Promise<void>
  readonly restoring: Ref<boolean>
}

/**
 * What a screen does when the sheet of a transfer ends (MOL-253): a transfer written is said —
 * «Переведено: 2 000 $ на «Доллары»» — an amendment too, and a removal is offered back in the
 * screen's «Вернуть». Brought back by the answer, never by the tap, as an account is: too late is
 * said and the strip goes, no answer puts the strip back — the server keeps the mark ten minutes.
 */
export function useTransferOutcome(): TransferOutcomes {
  const { t, locale } = useI18n()
  const announce = useAnnouncer()
  const store = useAccountsStore()
  const transfers = useTransfers()
  const removed = ref<{ readonly id: string; readonly stamp: number } | null>(null)
  const restoring = ref(false)

  function done(outcome: TransferOutcome): void {
    if (outcome.kind === 'removed') {
      removed.value = { id: outcome.transfer.id, stamp: Date.now() }
      return
    }
    // A write makes the removal before it final on the server: its «Вернуть» goes (review С-3).
    removed.value = null
    if (!outcome.created) {
      announce?.(t('transfer.saved'))
      return
    }
    const target = store.accounts.find(({ id }) => id === outcome.transfer.toAccountId)
    announce?.(
      t('transfer.done', {
        amount: asTyped(outcome.transfer.amount, locale.value),
        name: target?.name ?? '',
      }),
    )
  }

  async function restore(): Promise<void> {
    const value = removed.value
    if (!value || restoring.value) return
    restoring.value = true
    try {
      await transfers.restore(value.id)
      removed.value = null
      announce?.(t('transfer.restored'))
    } catch (caught) {
      const late = caught instanceof ApiError && caught.answered && caught.code === ERROR.NOT_FOUND
      if (late) {
        removed.value = null
        announce?.(t('transfer.restore_late'))
      } else {
        // The strip anew, for another ten seconds: the server keeps the mark ten minutes (А4).
        removed.value = { ...value, stamp: Date.now() }
        announce?.(t('transfer.restore_failed'))
      }
    } finally {
      restoring.value = false
    }
  }

  return { removed, done, restore, restoring }
}
