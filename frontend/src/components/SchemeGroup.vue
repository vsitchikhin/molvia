<template>
  <section class="group">
    <h2 class="caption">{{ t('settings.group_scheme') }}</h2>
    <SegmentedControl
      :model-value="scheme"
      :options="options"
      :legend="t('settings.group_scheme')"
      hide-legend
      fit
      :aria-describedby="`${id}-hint`"
      @update:model-value="pick"
    />
    <p :id="`${id}-hint`" class="hint">{{ t('settings.scheme.hint') }}</p>
  </section>
</template>

<script lang="ts">
import { computed, defineComponent, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import SegmentedControl from '@/components/SegmentedControl.vue'
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
  components: { SegmentedControl },
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
    return { t, id: useId(), scheme, options, pick }
  },
})
</script>

<style scoped lang="scss">
.caption {
  margin: 0 0 var(--space-3);
  padding: var(--space-1) var(--space-1) 0;
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.hint {
  margin: var(--space-2) 0 0;
  padding: 0 var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-footnote);
}
</style>
