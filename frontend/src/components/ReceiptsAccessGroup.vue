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
import { computed, defineComponent, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconReceipt from '~icons/mdi/receipt-text-outline'
import AppCard from '@/components/AppCard.vue'
import ListRow from '@/components/ListRow.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import { useLocalDay } from '@/composables/useLocalDay'
import { monthWords, useReceiptsAccess } from '@/composables/useReceiptsAccess'
import { dateOfAnyYear } from '@/days'

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
    const { access, closed, othersRead, askAgain } = useReceiptsAccess()
    // The month's hundred opens again on the 1st: a screen in view over midnight asks the server (adversarial А3).
    watch(today, askAgain)

    const status = computed(() => {
      const figures = access.value
      if (!figures) return t('receipts_access.status.unknown')
      const reads = othersRead.value ? 'read' : 'manual'
      if (closed.value === 'trial') return t(`receipts_access.status.trial_over_${reads}`)
      if (closed.value === 'ended')
        return t(`receipts_access.status.ended_${reads}`, {
          date: figures.ended
            ? dateOfAnyYear(figures.ended, locale.value, today.value, 'long')
            : '',
        })
      const words = monthWords(figures, t, locale.value)
      if (closed.value === 'month') return t('receipts_access.status.month_read', words)
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
