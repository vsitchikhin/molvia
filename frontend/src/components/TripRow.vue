<template>
  <ListRow
    :key="open ? 'open' : 'still'"
    :as="open ? 'button' : 'div'"
    class="row"
    :class="{ waiting: row.mark !== null, gone: row.mark === 'removing' }"
    wrap
    :next="open"
    @click="open && $emit('open', row)"
  >
    <template #title
      ><span class="name">{{ row.name }}</span></template
    >
    <template v-if="meta" #meta
      ><span class="quantity">{{ meta }}</span></template
    >
    <template v-if="row.mark || row.expense?.printed" #below>
      <AppTag v-if="row.mark" tone="warn">{{ t(`trip.queued.${row.mark}`) }}</AppTag>
      <!-- A purchase from a receipt: the line as the till printed it, grey under it (MOL-127, 5o). -->
      <span v-if="row.expense?.printed" class="printed">{{ row.expense.printed }}</span>
    </template>
    <template #tail
      ><span class="amount">{{ amount ?? '—' }}</span></template
    >
  </ListRow>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatMoney, formatQuantity, formatUnitPrice } from '@molvia/model'
import AppTag from '@/components/AppTag.vue'
import ListRow from '@/components/ListRow.vue'
import type { TripRowView } from './tripRow'

/**
 * «Молоко «Ашхар» · 1 л · 570 ֏ · 570 ֏/л» — and the price per unit is the whole point of
 * the line: 520 ֏ for 0,9 l is dearer than 570 ֏ for a litre, and nobody works that out at a
 * shelf. The number is the server's for a row it has answered; for one still in the queue the
 * screen computes it with the domain's own `unitPrice`, as the sheet does.
 *
 * A row of the kit (MOL-206, handoff 7a): the name, then the quantity and the price per unit in the
 * meta, the amount in the tail and the chevron of a row that opens the sheet. A price nobody entered
 * is «без цены» under the name and «—» in the tail — the chevron says the row is one tap from the
 * same sheet. There is no conversion here on purpose (handoff «Валюты»): eight rows × two numbers, half of
 * them estimates, is a screen nobody can read.
 */
export default defineComponent({
  name: 'TripRow',
  components: { AppTag, ListRow },
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
     * and come back as «не принято» about a purchase the person threw away themselves. A row of the
     * kit keeps its tag for its life, so one that stops opening is another row, drawn anew (`key`).
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

    /** «0,9 л · 577,78 ֏ за л», or «без цены» beside the quantity of a purchase nobody priced yet. */
    const meta = computed(() =>
      [quantity.value, amount.value ? perUnit.value : t('trip.unpriced')]
        .filter((part) => part !== null)
        .join(' · '),
    )

    return { t, open, meta, amount }
  },
})
</script>

<style scoped lang="scss">
/* Not the server's last word yet: the queue still holds something about this line. Its tag says what;
   the fill and the bar at the side say it at a glance. */
.waiting {
  background: var(--surface-2);
  box-shadow: inset 3px 0 0 var(--warn);
}

.gone .name,
.gone .quantity,
.gone .amount {
  text-decoration: line-through;
}

.quantity,
.amount {
  font-variant-numeric: tabular-nums;
}

.printed {
  display: block;
  overflow: hidden;
  margin-top: var(--space-1);
  color: var(--text-muted);
  font-family: var(--font-printed);
  font-size: var(--text-footnote);
  line-height: var(--leading-body);
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
