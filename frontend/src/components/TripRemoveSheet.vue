<template>
  <BottomSheet
    ref="sheet"
    :open="open"
    :on-closed="onClosed"
    @update:open="$emit('update:open', $event)"
  >
    <template #title>{{ t('trip.remove.sheet.title') }}</template>
    <!-- Only while there is something to name: a closed sheet stays in the page, and «0 позиций»
         there was a second `.meta` beside the screen's own. -->
    <template v-if="items > 0" #meta>{{ meta }}</template>

    <p class="words">{{ t('trip.remove.sheet.body') }}</p>

    <template #footer>
      <AppButton variant="danger-ghost" block @click="confirm">
        {{ t('trip.remove.action') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent, ref } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/AppButton.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import { dayOfAnyYear } from '@/days'

/**
 * «Удалить поход?» (MOL-76, Р-2): asked only of a trip with purchases, and it names what goes —
 * the shop, the day and how many rows, the ones still waiting in the queue included. «Вернуть»
 * stays offered after, as for an exchange (MOL-40, В-5): a mis-tap here takes a whole shop.
 */
export default defineComponent({
  name: 'TripRemoveSheet',
  components: { AppButton, BottomSheet },
  props: {
    open: { type: Boolean, required: true },
    place: { type: String, required: true },
    /**
     * The day the list calls the trip by: its start while open, its end once finished — with the
     * year when it is not this one, as the history's row says it (review Р-2).
     */
    day: { type: Date as PropType<Date | null>, default: null },
    items: { type: Number, required: true },
    onClosed: { type: Function as PropType<() => void>, default: undefined },
    /**
     * How many layers «Удалить» puts away: two on a finished trip's own screen — the sheet and the
     * screen, in one step back, since a move made while the sheet steps off its entry is lost.
     */
    steps: { type: Number as PropType<1 | 2>, default: 1 },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    confirm: () => true,
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const sheet = ref<{ close: (steps?: number) => void } | null>(null)
    function confirm(): void {
      emit('confirm')
      if (props.steps > 1 && sheet.value) sheet.value.close(props.steps)
      else emit('update:open', false)
    }
    const meta = computed(() =>
      [
        props.place,
        props.day ? dayOfAnyYear(props.day, locale.value) : null,
        t('trip.items_count', { n: props.items }, props.items),
      ]
        .filter((part) => part !== null && part !== '')
        .join(' · '),
    )
    return { t, meta, sheet, confirm }
  },
})
</script>

<style scoped lang="scss">
.words {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-callout);
}
</style>
