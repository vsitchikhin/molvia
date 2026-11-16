<template>
  <section class="group">
    <SectionCaption>{{ caption }}</SectionCaption>
    <SegmentedControl
      :model-value="modelValue"
      :options="options"
      :legend="caption"
      hide-legend
      fit
      :aria-describedby="`${id}-hint`"
      @update:model-value="pick"
    />
    <p :id="`${id}-hint`" class="hint">{{ hint }}</p>
  </section>
</template>

<script lang="ts">
import { defineComponent, useId } from 'vue'
import type { PropType } from 'vue'
import SectionCaption from '@/components/SectionCaption.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import type { Segment } from '@/components/SegmentedControl.vue'

/**
 * A choice of this device on «Настройки» (MOL-111, MOL-398): a caption, its segments as wide as their
 * words (`fit`), and a hint under them — «Тема», «Язык», «Date format». Taken on the tap, with nothing
 * to save: the screen itself is the answer. A value none of the segments has is not passed on.
 */
export default defineComponent({
  name: 'DeviceChoiceGroup',
  components: { SectionCaption, SegmentedControl },
  props: {
    caption: { type: String, required: true },
    hint: { type: String, required: true },
    options: { type: Array as PropType<Segment[]>, required: true },
    modelValue: { type: String, required: true },
  },
  emits: { 'update:modelValue': (value: string) => value.length > 0 },
  setup(props, { emit }) {
    function pick(value: string): void {
      if (props.options.some((option) => option.value === value)) emit('update:modelValue', value)
    }
    return { id: useId(), pick }
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
