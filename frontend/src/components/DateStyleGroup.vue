<template>
  <section class="group">
    <SectionCaption>{{ t('settings.group_date_style') }}</SectionCaption>
    <SegmentedControl
      :model-value="style"
      :options="styles"
      :legend="t('settings.group_date_style')"
      hide-legend
      fit
      :aria-describedby="`${id}-hint`"
      @update:model-value="pick"
    />
    <p :id="`${id}-hint`" class="hint">{{ t('settings.date_style.hint') }}</p>
  </section>
</template>

<script lang="ts">
import { defineComponent, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import SectionCaption from '@/components/SectionCaption.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import type { Segment } from '@/components/SegmentedControl.vue'
import { useLocale } from '@/composables/useLocale'
import type { DateStyle } from '@/composables/useLocale'

const STYLES: readonly (readonly [DateStyle, string])[] = [
  ['gb', 'en-GB'],
  ['us', 'en-US'],
]

/** A day and an hour each order is shown by: a sample of the order, not a date anybody reads. */
const SAMPLE = new Date(Date.UTC(2026, 10, 16, 14, 5))

/**
 * «Date format» (MOL-398, owner's В-3 «б» and its note): the order of an English day on this device —
 * British by default, American by choice — shown only while the screens speak English, under
 * «Язык». Each is named by a day and an hour written in it, which says more than «UK» and «US».
 */
export default defineComponent({
  name: 'DateStyleGroup',
  components: { SectionCaption, SegmentedControl },
  setup() {
    const { t } = useI18n()
    const { style, chooseStyle } = useLocale()
    const styles: Segment[] = STYLES.map(([value, tag]) => ({
      value,
      label: new Intl.DateTimeFormat(tag, {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'UTC',
      }).format(SAMPLE),
    }))
    function pick(value: string): void {
      const chosen = STYLES.find(([known]) => known === value)
      if (chosen) chooseStyle(chosen[0])
    }
    return { t, id: useId(), style, styles, pick }
  },
})
</script>

<style scoped lang="scss">
.hint {
  margin: var(--space-2) 0 0;
  padding: 0 var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-footnote);
}
</style>
