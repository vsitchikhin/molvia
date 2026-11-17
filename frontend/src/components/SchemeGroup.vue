<template>
  <DeviceChoiceGroup
    :caption="t('settings.group_scheme')"
    :hint="t('settings.scheme.hint')"
    :options="options"
    :model-value="scheme"
    @update:model-value="pick"
  />
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import DeviceChoiceGroup from '@/components/DeviceChoiceGroup.vue'
import type { Segment } from '@/components/SegmentedControl.vue'
import { useColorScheme } from '@/composables/useColorScheme'
import type { Scheme } from '@/composables/useColorScheme'

const SCHEMES: readonly Scheme[] = ['system', 'light', 'dark']

/**
 * «Тема» (MOL-111): the scheme of this device, under «Напоминания» (owner's decision В-2). Taken on
 * the tap and drawn at once, with nothing to save and nothing said — the whole screen is the answer.
 * It asks nothing of the server, so it stands in every state of the screen, offline included. The
 * control is not in a card and its segments are as wide as their words (В-1): even thirds on a 320 px
 * phone left «Системная» a pixel of room.
 */
export default defineComponent({
  name: 'SchemeGroup',
  components: { DeviceChoiceGroup },
  setup() {
    const { t } = useI18n()
    const { scheme, choose } = useColorScheme()
    const options = computed<Segment[]>(() =>
      SCHEMES.map((value) => ({ value, label: t(`settings.scheme.${value}`) })),
    )
    function pick(value: string): void {
      const chosen = SCHEMES.find((known) => known === value)
      if (chosen) choose(chosen)
    }
    return { t, scheme, options, pick }
  },
})
</script>
