<template>
  <section>
    <SectionCaption>{{ t('settings.group_receipts') }}</SectionCaption>
    <AppCard as="ul" list>
      <li>
        <!-- A status, no chevron (owner's В-3 «а»): nothing to open until payment comes (MOL-277). -->
        <ListRow
          as="div"
          :icon="IconReceipt"
          :title="t('receipts_access.title')"
          :meta="status"
          whole
        />
      </li>
    </AppCard>
  </section>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import IconReceipt from '~icons/mdi/receipt-text-outline'
import AppCard from '@/components/AppCard.vue'
import ListRow from '@/components/ListRow.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import { useLocalDay } from '@/composables/useLocalDay'
import type { ReceiptsClosed } from '@molvia/model'
import {
  closedWords,
  monthWords,
  useAccessKeptFresh,
  useReceiptsAccess,
} from '@/composables/useReceiptsAccess'
import { dateOfAnyYear } from '@/days'

/** The status of each reason, by whether Tesseract reads meanwhile: the month's hundred says only when it opens again. */
const STATUS: Record<ReceiptsClosed, { readonly read: string; readonly manual: string }> = {
  trial: {
    read: 'receipts_access.status.trial_over_read',
    manual: 'receipts_access.status.trial_over_manual',
  },
  ended: {
    read: 'receipts_access.status.ended_read',
    manual: 'receipts_access.status.ended_manual',
  },
  month: { read: 'receipts_access.status.month_read', manual: 'receipts_access.status.month_read' },
}

/**
 * «Распознавание чеков» (MOL-276): where the person stands with the model that reads receipts — until when it is
 * paid, the trial left, the month's hundred — every figure the server's, read by `/actors/me`, which the settings
 * ask anyway as they open. The screen draws it only where receipts are read off the photo (Armenia, Georgia): Serbia's
 * are read by their link, and the model reads none of them.
 */
export default defineComponent({
  name: 'ReceiptsAccessGroup',
  components: { AppCard, ListRow, SectionCaption },
  setup() {
    const { t, locale } = useI18n()
    const today = useLocalDay()
    const { access, closed, othersRead } = useReceiptsAccess()
    // the settings' form reads `/actors/me` as it opens and as the app comes back (review №12)
    useAccessKeptFresh({ readByScreen: true })

    const status = computed(() => {
      const figures = access.value
      if (!figures) return t('receipts_access.status.unknown')
      const reason = closed.value
      if (reason)
        return t(
          STATUS[reason][othersRead.value ? 'read' : 'manual'],
          closedWords(reason, figures, t, locale.value, today.value),
        )
      const words = monthWords(figures, t, locale.value)
      if (figures.until)
        return t('receipts_access.status.paid', {
          until: dateOfAnyYear(figures.until, locale.value, today.value, 'long'),
          month: words.month,
          read: figures.read,
          limit: figures.limit,
        })
      return t('receipts_access.status.trial', { left: figures.trialLeft, of: figures.trialOf })
    })

    return { t, IconReceipt, status }
  },
})
</script>
