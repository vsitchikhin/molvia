<template>
  <DeviceChoiceGroup
    :caption="t('settings.group_locale')"
    :hint="t('settings.locale.hint')"
    :options="languages"
    :model-value="choice"
    @update:model-value="pick"
  />
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import DeviceChoiceGroup from '@/components/DeviceChoiceGroup.vue'
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
  components: { DeviceChoiceGroup },
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
    function pick(value: string): void {
      const chosen = CHOICES.find((known) => known === value)
      if (chosen) choose(chosen)
    }
    return { t, choice, languages, pick }
  },
})
</script>
