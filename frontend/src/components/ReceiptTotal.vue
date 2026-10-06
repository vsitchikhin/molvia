<template>
  <AppCard class="total">
    <!-- A receipt with no items (MOL-227) has no lines to set against its total. -->
    <template v-if="!noItems">
      <div class="line">
        <span>{{ t('receipt.review.lines') }}</span>
        <span class="figure">{{ linesText ?? '—' }}</span>
      </div>
      <hr class="rule" />
    </template>
    <!-- The total is a button (Р-8): OCR misses it on half the receipts, and the trip's money is the
         receipt's total (MOL-78) — the person types it in the sheet of «Сумма по чеку». -->
    <button class="line main" type="button" @click="$emit('total')">
      <span v-if="totalText" class="label">{{ t('receipt.review.total') }}</span>
      <span v-else class="missing">{{ t('receipt.review.total_missing') }}</span>
      <span v-if="totalText" class="amount">{{ totalText }}</span>
      <IconChevronRight class="chevron" aria-hidden="true" />
    </button>
    <p v-if="approx" class="approx">{{ approx }}</p>
    <p v-if="difference" class="difference">
      <IconAlert class="difference-icon" aria-hidden="true" />
      {{ difference }}
    </p>
  </AppCard>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconChevronRight from '~icons/mdi/chevron-right'
import { convertMoney, formatEstimate, formatMoney } from '@molvia/model'
import type { ExchangeRate, Money, ReceiptBalance } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'
import { calendarDay } from '@/days'

/**
 * The foot of a receipt on the review (handoff 05): «Строки», the receipt's total, what it is in the
 * person's income currency by the rate of the receipt's day, and the difference with the line it
 * likely sits in. Every figure comes from `receiptBalance` of the model (В-6) or from the server;
 * none is added up here.
 */
export default defineComponent({
  name: 'ReceiptTotal',
  components: { AppCard, IconAlert, IconChevronRight },
  props: {
    balance: { type: Object as PropType<ReceiptBalance>, required: true },
    total: { type: Object as PropType<Money | null>, default: null },
    rate: { type: Object as PropType<ExchangeRate | null>, default: null },
    /** The day the rate is of: the receipt's. */
    day: { type: String, required: true },
    /** The name of the line the difference likely sits in. */
    suspect: { type: String as PropType<string | null>, default: null },
    /** A receipt with no items (MOL-227): the total alone, no «Строки» and no difference. */
    noItems: { type: Boolean, default: false },
  },
  emits: { total: () => true },
  setup(props) {
    const { t, locale } = useI18n()
    const money = (value: Money | null) => (value ? formatMoney(value, locale.value) : null)
    const approx = computed(() => {
      const { total, rate } = props
      if (!total || !rate) return null
      try {
        return t('receipt.review.approx', {
          amount: formatEstimate(convertMoney(total, rate), locale.value),
          day: calendarDay(props.day, locale.value, { day: 'numeric', month: 'short' }),
        })
      } catch {
        return null
      }
    })
    const difference = computed(() => {
      const gap = props.balance.difference
      if (props.noItems || !gap || gap.minor === 0n) return null
      const amount = formatMoney(
        { ...gap, minor: gap.minor < 0n ? -gap.minor : gap.minor },
        locale.value,
      )
      return props.suspect
        ? t('receipt.review.diff', { amount, line: props.suspect })
        : t('receipt.review.diff_unknown', { amount })
    })
    return {
      t,
      linesText: computed(() => money(props.balance.lines)),
      totalText: computed(() => money(props.total)),
      approx,
      difference,
    }
  },
})
</script>

<style scoped lang="scss">
.total {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-4);
}

.line {
  display: flex;
  gap: var(--space-3);
  align-items: baseline;
  justify-content: space-between;
  color: var(--text-muted);
  font-size: var(--text-callout);
}

.main {
  align-items: center;
  min-height: var(--touch-target);
  padding: 0;
  border: 0;
  color: var(--text);
  background: none;
  text-align: left;
  font: inherit;
  cursor: pointer;

  &:focus-visible {
    @include focus-ring;
  }
}

.label {
  flex: 1;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
}

.missing {
  flex: 1;
  color: var(--accent-ink);
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
}

.amount {
  @include display-type;

  font-size: var(--text-figure);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.figure {
  font-variant-numeric: tabular-nums;
}

.chevron {
  @include icon;

  font-size: var(--icon);
  color: var(--text-muted);
}

.rule {
  width: 100%;
  margin: 0;
  border: 0;
  border-top: var(--hairline) solid var(--border);
}

.approx {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  text-align: right;
}

.difference {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  margin: var(--space-2) 0 0;
  padding: var(--space-3);
  border-radius: var(--radius);
  color: var(--warn-ink);
  background: var(--warn-tint);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.difference-icon {
  @include icon;

  font-size: var(--icon-sm);
}
</style>
