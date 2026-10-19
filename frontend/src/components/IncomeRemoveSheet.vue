<template>
  <BottomSheet :open="open" back @update:open="$emit('update:open', $event)">
    <template #title>{{ t('income.remove_sheet.title') }}</template>
    <template v-if="income" #meta>{{ amounts }}</template>

    <p class="words">{{ t('income.remove_sheet.body') }}</p>

    <template #footer>
      <p v-if="failed" class="failed" role="alert">{{ t('income.failed') }}</p>
      <AppButton
        variant="danger-ghost"
        size="large"
        block
        :busy="busy"
        :busy-label="t('income.remove_sheet.confirm_busy')"
        :inactive="!online && !busy"
        @click="$emit('confirm')"
      >
        <template #icon><IconDelete /></template>
        {{ online || busy ? t('income.remove_sheet.confirm') : t('income.sheet.remove_offline') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import type { IncomeView } from '@molvia/model'
import IconDelete from '~icons/mdi/trash-can-outline'
import AppButton from '@/components/AppButton.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import { useOnline } from '@/composables/useOnline'

/**
 * «Удалить доход?» (MOL-66, as В-5 of MOL-40): the amount, the source and the day, and what removing
 * does — past trips keep their rate, and new ones work it out without the income **if it was part
 * of it**. Said as a condition, not a promise: whether it still is only the whole walk knows — an
 * income in roubles never is, one in euros is not until exchanged, and an exchange with no
 * remainder after it starts the rate afresh (self-review Ч-2, adversarial round 2, Е1). After it the
 * screen still offers «Вернуть».
 *
 * Opened from the sheet of the amendment and over it (MOL-189, Ф-34, Д-1): «‹» back to what was
 * typed there, no ×. Without a connection its button is not now and says why (Ф-6).
 */
export default defineComponent({
  name: 'IncomeRemoveSheet',
  components: { AppButton, BottomSheet, IconDelete },
  props: {
    open: { type: Boolean, required: true },
    income: { type: Object as PropType<IncomeView | null>, default: null },
    /** The income named as the list names it. */
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
