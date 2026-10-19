<template>
  <BottomSheet :open="open" back @update:open="$emit('update:open', $event)">
    <template #title>{{ t('exchange.remove_sheet.title') }}</template>
    <template v-if="exchange" #meta>{{ amounts }}</template>

    <p class="words">{{ t('exchange.remove_sheet.body') }}</p>

    <template #footer>
      <p v-if="failed" class="failed" role="alert">{{ t('exchange.failed') }}</p>
      <AppButton
        variant="danger-ghost"
        size="large"
        block
        :busy="busy"
        :busy-label="t('exchange.remove_sheet.confirm_busy')"
        :inactive="!online && !busy"
        @click="$emit('confirm')"
      >
        <template #icon><IconDelete /></template>
        {{
          online || busy ? t('exchange.remove_sheet.confirm') : t('exchange.sheet.remove_offline')
        }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ExchangeView } from '@molvia/model'
import IconDelete from '~icons/mdi/trash-can-outline'
import AppButton from '@/components/AppButton.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import { useOnline } from '@/composables/useOnline'

/**
 * «Удалить обмен?» (MOL-40, owner's decision В-5): the amounts and the day of the exchange, and
 * what removing does — the rate of new trips is worked out again, past trips keep theirs. There is
 * no amending an exchange, so a mis-tap on the bin would take three numbers the person may no
 * longer remember; after it the screen still offers «Вернуть».
 *
 * Opened from the sheet of the amendment and over it (MOL-189, Ф-34, Д-1): «‹» back to what was
 * typed there, no ×. Without a connection its button is not now and says why (Ф-6).
 */
export default defineComponent({
  name: 'ExchangeRemoveSheet',
  components: { AppButton, BottomSheet, IconDelete },
  props: {
    open: { type: Boolean, required: true },
    exchange: { type: Object as PropType<ExchangeView | null>, default: null },
    /** The exchange named as the list names it: the amounts and the day. */
    amounts: { type: String, default: '' },
    busy: { type: Boolean, default: false },
    /** The last «Удалить» did not reach the server: nothing removed, the sheets stay (MOL-189, А5). */
    failed: { type: Boolean, default: false },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    confirm: () => true,
  },
  setup() {
    return { t: useI18n().t, online: useOnline() }
  },
})
</script>

<style scoped lang="scss">
.words {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-callout);
}

.failed {
  margin: 0 0 var(--space-3);
  color: var(--bad-ink);
  font-size: var(--text-footnote);
}
</style>
