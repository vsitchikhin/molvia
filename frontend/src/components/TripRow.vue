<template>
  <component
    :is="open ? 'button' : 'div'"
    class="row"
    :class="{ waiting: row.mark !== null, gone: row.mark === 'removing' }"
    :type="open ? 'button' : undefined"
    @click="open && $emit('open', row)"
  >
    <span class="what">
      <span class="name">
        {{ row.name }}
        <span v-if="row.mark" class="mark">{{ t(`trip.queued.${row.mark}`) }}</span>
      </span>
      <span v-if="quantity" class="quantity">{{ quantity }}</span>
    </span>

    <span class="price">
      <template v-if="amount">
        <span class="amount">{{ amount }}</span>
        <span v-if="perUnit" class="per-unit">{{ perUnit }}</span>
      </template>
      <span v-else class="add-price">{{ t('trip.add_price') }}</span>
    </span>
  </component>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatMoney, formatQuantity, formatUnitPrice } from '@molvia/model'
import type { TripRowView } from './tripRow'

/**
 * «Молоко «Ашхар» · 1 л · 570,00 ֏ · 570,00 ֏/л» — and the price per unit is the whole point of
 * the line: 520 ֏ for 0,9 l is dearer than 570 ֏ for a litre, and nobody works that out at a
 * shelf. The number is the server's for a row it has answered; for one still in the queue the
 * screen computes it with the domain's own `unitPrice`, as the sheet does.
 *
 * A price nobody entered is «Добавить цену» instead — the row is one tap from the same sheet.
 * There is no conversion here on purpose (handoff «Валюты»): eight rows × two numbers, half of
 * them estimates, is a screen nobody can read.
 */
export default defineComponent({
  name: 'TripRow',
  props: {
    row: { type: Object as PropType<TripRowView>, required: true },
  },
  emits: {
    open: (row: TripRowView) => typeof row === 'object',
  },
  setup(props) {
    const { t, locale } = useI18n()

    /**
     * A row opens the sheet when there is a card to open it on — and not while it is being
     * removed: an amendment queued behind the removal would reach a row the server no longer has,
     * and come back as «не принято» about a purchase the person threw away themselves.
     */
    const open = computed(() => props.row.entry !== null && props.row.mark !== 'removing')

    const quantity = computed(() => {
      const value = props.row.quantity
      return value
        ? t('trip.quantity', {
            amount: formatQuantity(value, locale.value),
            unit: t(`item.unit_${value.unit}`),
          })
        : null
    })

    const amount = computed(() =>
      props.row.amount ? formatMoney(props.row.amount, locale.value) : null,
    )

    const perUnit = computed(() => {
      const price = props.row.unitPrice
      return price
        ? t('trip.unit_price', {
            amount: formatUnitPrice(price, locale.value),
            unit: t(`item.unit_${price.unit}`),
          })
        : null
    })

    return { t, open, quantity, amount, perUnit }
  },
})
</script>

<style scoped lang="scss">
.row {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
  width: 100%;
  min-height: var(--touch-target);
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;

  &:focus-visible {
    @include focus-ring;
  }
}

button.row {
  cursor: pointer;
}

/* Not the server's last word yet: the queue still holds something about this line. */
.waiting {
  background: var(--surface-2);
  box-shadow: inset 3px 0 0 var(--warn);
}

.gone .name,
.gone .quantity,
.gone .amount {
  opacity: 0.5;
  text-decoration: line-through;
}

.what {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.name {
  overflow-wrap: anywhere;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
}

.mark {
  display: inline-block;
  margin-left: var(--space-2);
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--warn-tint);
  color: var(--warn-ink);
  font-size: var(--text-caption);
  font-weight: var(--weight-medium);
  white-space: nowrap;
  vertical-align: middle;
}

.quantity,
.per-unit {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.price {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: flex-end;
  white-space: nowrap;
}

.amount,
.per-unit {
  font-variant-numeric: tabular-nums;
}

.amount {
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
}

.add-price {
  color: var(--accent-ink);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}
</style>
