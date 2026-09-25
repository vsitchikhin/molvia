<template>
  <BottomSheet :open="open" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('exchange.remove_sheet.title') }}</template>
    <template v-if="exchange" #meta>{{ amounts }}</template>

    <p class="words">{{ t('exchange.remove_sheet.body') }}</p>

    <template #footer>
      <AppButton variant="danger-ghost" block :disabled="busy" @click="$emit('confirm')">
        {{ t('exchange.remove_sheet.confirm') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ExchangeView } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import BottomSheet from '@/components/BottomSheet.vue'

/**
 * «Удалить обмен?» (MOL-40, owner's decision В-5): the amounts and the day of the exchange, and
 * what removing does — the rate of new trips is worked out again, past trips keep theirs. There is
 * no amending an exchange, so a mis-tap on the bin would take three numbers the person may no
 * longer remember; after it the screen still offers «Вернуть».
 */
export default defineComponent({
  name: 'ExchangeRemoveSheet',
  components: { AppButton, BottomSheet },
  props: {
    open: { type: Boolean, required: true },
    exchange: { type: Object as PropType<ExchangeView | null>, default: null },
    /** The exchange named as the list names it: the amounts and the day. */
    amounts: { type: String, default: '' },
    busy: { type: Boolean, default: false },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    confirm: () => true,
  },
  setup() {
    return { t: useI18n().t }
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
