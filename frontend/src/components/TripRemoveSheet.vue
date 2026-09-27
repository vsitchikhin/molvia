<template>
  <BottomSheet :open="open" :on-closed="onClosed" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('trip.remove.sheet.title') }}</template>
    <template #meta>{{ meta }}</template>

    <p class="words">{{ t('trip.remove.sheet.body') }}</p>

    <template #footer>
      <AppButton variant="danger-ghost" block @click="$emit('confirm')">
        {{ t('trip.remove.action') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/AppButton.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import { purchaseDay } from '@/days'

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
    /** The day the list calls the trip by: its start while open, its end once finished. */
    day: { type: Date as PropType<Date | null>, default: null },
    items: { type: Number, required: true },
    onClosed: { type: Function as PropType<() => void>, default: undefined },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    confirm: () => true,
  },
  setup(props) {
    const { t, locale } = useI18n()
    const meta = computed(() =>
      [
        props.place,
        props.day ? purchaseDay(props.day, locale.value) : null,
        t('trip.items_count', { n: props.items }, props.items),
      ]
        .filter((part) => part !== null && part !== '')
        .join(' · '),
    )
    return { t, meta }
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
