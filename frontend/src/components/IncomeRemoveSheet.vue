<template>
  <BottomSheet :open="open" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('income.remove_sheet.title') }}</template>
    <template v-if="income" #meta>{{ amounts }}</template>

    <p class="words">{{ t('income.remove_sheet.body') }}</p>

    <template #footer>
      <AppButton variant="danger-ghost" block :disabled="busy" @click="$emit('confirm')">
        {{ t('income.remove_sheet.confirm') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import type { IncomeView } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import BottomSheet from '@/components/BottomSheet.vue'

/**
 * «Удалить доход?» (MOL-66, as В-5 of MOL-40): the amount, the source and the day, and what removing
 * does — past trips keep their rate, and new ones work it out without the income **if it was part
 * of it**. Said as a condition, not a promise: whether it still is only the whole walk knows — an
 * income in roubles never is, one in euros is not until exchanged, and an exchange with no
 * remainder after it starts the rate afresh (self-review Ч-2, adversarial round 2, Е1). After it the
 * screen still offers «Вернуть» for ten minutes.
 */
export default defineComponent({
  name: 'IncomeRemoveSheet',
  components: { AppButton, BottomSheet },
  props: {
    open: { type: Boolean, required: true },
    income: { type: Object as PropType<IncomeView | null>, default: null },
    /** The income named as the list names it. */
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
