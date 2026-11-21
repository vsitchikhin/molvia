<template>
  <DeviceChoiceGroup
    :caption="t('settings.group_date_style')"
    :hint="t('settings.date_style.hint')"
    :options="styles"
    :model-value="style"
    @update:model-value="pick"
  />
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import DeviceChoiceGroup from '@/components/DeviceChoiceGroup.vue'
import type { Segment } from '@/components/SegmentedControl.vue'
import { tagOf, useLocale } from '@/composables/useLocale'
import type { DateStyle } from '@/composables/useLocale'

const STYLES: readonly DateStyle[] = ['gb', 'us']

/** A day and an hour each order is shown by: a sample of the order, not a date anybody reads. */
const SAMPLE = new Date(Date.UTC(2026, 10, 16, 14, 5))

/**
 * «Date format» (MOL-398, owner's В-3 «б» and its note): the order of an English day on this device —
 * British by default, American by choice — shown only while the screens speak English, under
 * «Язык». Each is named by a day and an hour written in it, which says more than «UK» and «US»; the
 * tag it is written by is `tagOf`'s, the one the screens speak (review №4).
 */
export default defineComponent({
  name: 'DateStyleGroup',
  components: { DeviceChoiceGroup },
  setup() {
    const { t } = useI18n()
    const { style, chooseStyle } = useLocale()
    const styles: Segment[] = STYLES.map((value) => ({
      value,
      label: new Intl.DateTimeFormat(tagOf('en', value), {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'UTC',
      }).format(SAMPLE),
    }))
    function pick(value: string): void {
      const chosen = STYLES.find((known) => known === value)
      if (chosen) void chooseStyle(chosen)
    }
    return { t, style, styles, pick }
  },
})
</script>
