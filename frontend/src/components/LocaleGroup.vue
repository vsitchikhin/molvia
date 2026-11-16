<template>
  <section class="group">
    <SectionCaption>{{ t('settings.group_locale') }}</SectionCaption>
    <SegmentedControl
      :model-value="choice"
      :options="languages"
      :legend="t('settings.group_locale')"
      hide-legend
      fit
      :aria-describedby="`${id}-hint`"
      @update:model-value="pickLanguage"
    />
    <p :id="`${id}-hint`" class="hint">{{ t('settings.locale.hint') }}</p>
  </section>
</template>

<script lang="ts">
import { computed, defineComponent, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import SectionCaption from '@/components/SectionCaption.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import type { Segment } from '@/components/SegmentedControl.vue'
import { useLocale } from '@/composables/useLocale'
import type { LocaleChoice } from '@/composables/useLocale'

const CHOICES: readonly LocaleChoice[] = ['device', 'ru', 'en']

/**
 * «Язык» (MOL-398): the language of this device, under «Тема» and drawn as it is — taken on the tap,
 * the whole screen is the answer. It asks nothing of the server, so it stands in every state of the
 * screen, offline included. A language is named in itself, in its own `lang`: whoever cannot read the
 * screen's finds theirs. The order of an English day is `DateStyleGroup`'s, under it.
 */
export default defineComponent({
  name: 'LocaleGroup',
  components: { SectionCaption, SegmentedControl },
  setup() {
    const { t } = useI18n()
    const { choice, choose } = useLocale()
    const languages = computed<Segment[]>(() =>
      CHOICES.map((value) =>
        value === 'device'
          ? { value, label: t('settings.locale.device') }
          : { value, label: t(`settings.locale.${value}`), lang: value },
      ),
    )
    function pickLanguage(value: string): void {
      const chosen = CHOICES.find((known) => known === value)
      if (chosen) choose(chosen)
    }
    return { t, id: useId(), choice, languages, pickLanguage }
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
