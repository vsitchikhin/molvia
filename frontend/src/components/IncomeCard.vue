<template>
  <AppCard as="article" class="card">
    <OperationCardHead
      :day="day"
      :amended="income.amendedAt ? t('income.amended', { date: dayOf(income.amendedAt) }) : null"
      :remove-label="t('income.remove', { amount })"
      :disabled="disabled"
      @remove="$emit('remove', income)"
    />
    <!-- The way into its amendment, as an exchange's is (MOL-42, В-3). No `aria-label`: it would
         silence the source, the amount and the note. The verb and the day are said first. -->
    <button class="body" type="button" :disabled="disabled" @click="$emit('edit', income)">
      <span class="verb">{{ t('income.edit_on', { date: day }) }}</span>
      <span class="line">
        <span class="source">{{ t(`income.source.${income.source}`) }}</span>
        <span class="amount">{{ amount }}</span>
      </span>
      <!-- Only when there is something to say: an income with neither is shorter. -->
      <span v-if="accountName || income.note" class="plate">
        <span v-if="accountName" class="account">
          <span class="account-label">{{ t('accounts.picker.row_income') }}</span>
          <span class="account-name">{{ t('accounts.card_name', { name: accountName }) }}</span>
        </span>
        <span v-if="income.note" class="note" :class="{ under: accountName }">
          <IconNote class="note-icon" aria-hidden="true" />
          <span class="note-text">{{ income.note }}</span>
        </span>
      </span>
    </button>
  </AppCard>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconNote from '~icons/mdi/note-text-outline'
import type { IncomeView } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'
import OperationCardHead from '@/components/OperationCardHead.vue'
import { asTyped } from '@/components/spending'
import { calendarDay, purchaseDay } from '@/days'
import { useAccountsStore } from '@/stores/accounts'

/**
 * One income (MOL-81, handoff 03), in the grammar of an exchange's card: «when» on top, «from
 * where and how much» in the middle, the note on a plate below.
 */
export default defineComponent({
  name: 'IncomeCard',
  components: { AppCard, IconNote, OperationCardHead },
  props: {
    income: { type: Object as PropType<IncomeView>, required: true },
    disabled: { type: Boolean, default: false },
  },
  emits: {
    edit: (income: IncomeView) => typeof income === 'object',
    remove: (income: IncomeView) => typeof income === 'object',
  },
  setup(props) {
    const { t, locale } = useI18n()
    const dayOf = (when: Date): string => purchaseDay(when, locale.value)
    const accounts = useAccountsStore()
    return {
      t,
      dayOf,
      // «На счёт «Наличные ₽»», by the name the account has now (MOL-81 Р-6, MOL-123).
      accountName: computed(() =>
        props.income.accountId
          ? (accounts.accounts.find((account) => account.id === props.income.accountId)?.name ??
            null)
          : null,
      ),
      // A calendar day of Yerevan, never the moment of its midnight: west of UTC+4 an income of
      // 1 September read «31 авг.» (adversarial Ж). «исправлен» is a moment, and stays one.
      day: computed(() =>
        calendarDay(props.income.receivedOn, locale.value, { day: 'numeric', month: 'short' }),
      ),
      // As it was typed, as everywhere in «Деньги» (owner's decision В-1).
      amount: computed(() => asTyped(props.income.amount, locale.value)),
    }
  },
})
</script>

<style scoped lang="scss">
.card {
  padding: 0;
}

.body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
  padding: 0 var(--space-4) var(--space-4);
  border: 0;
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--surface-2);
  }

  &:focus-visible {
    @include focus-ring(-2px);
  }

  &:disabled {
    cursor: default;
  }
}

.verb {
  @include visually-hidden;
}

.line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}

.source {
  min-width: 0;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
}

.amount {
  font-family: var(--font-display);
  font-size: var(--text-card-figure);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.plate {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.account {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
}

.account-name {
  color: var(--text);
  font-weight: var(--weight-bold);
  overflow-wrap: anywhere;
  text-align: right;
}

.note {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);

  &.under {
    padding-top: var(--space-2);
    border-top: var(--hairline) solid var(--border);
  }
}

.note-icon {
  flex: none;
  width: var(--space-4);
  height: var(--space-4);
}

.note-text {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
