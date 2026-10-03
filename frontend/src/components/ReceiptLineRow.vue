<template>
  <button
    class="receipt-line"
    :class="{ skipped: line.skip }"
    type="button"
    :aria-label="spoken"
    @click="$emit('open')"
  >
    <span class="text">
      <span class="name">{{ line.name }}</span>
      <!-- The line as the till printed it, in the system's face and the receipt's language: one
           line, its height fixed, so an Armenian or Georgian word does not move the row. -->
      <span class="printed" :lang="lang">{{ line.line.printed }}</span>
      <span v-if="line.check && line.line.translation" class="figures">{{
        t('receipt.review.check_note', { text: line.line.translation })
      }}</span>
      <span v-if="figures" class="figures">
        {{ figures }}
        <span v-if="line.mismatch && printed" class="mismatch">{{
          t('receipt.review.mismatch', { printed })
        }}</span>
      </span>
      <span v-if="tags.length > 0" class="tags">
        <span v-for="tag in tags" :key="tag.key" class="tag" :class="tag.key">{{ tag.text }}</span>
      </span>
    </span>
    <span v-if="sum" class="sum">{{ sum }}</span>
    <IconChevronRight class="chevron" aria-hidden="true" />
  </button>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconChevronRight from '~icons/mdi/chevron-right'
import { formatMoney, formatQuantity } from '@molvia/model'
import type { ReviewLine } from '@/receipts/review'

/**
 * One line of a receipt on the review (handoff 05): the item in the person's language, the line as
 * printed, «кол-во × цена», the printed sum where it disagrees («≠ 980», a highlight that refuses
 * nothing), the marks «новый товар», «проверьте», «не записываем», and on the right what the line
 * will be recorded at. A screen reader hears «товар, кол-во × цена, сумма, метка».
 */
export default defineComponent({
  name: 'ReceiptLineRow',
  components: { IconChevronRight },
  props: {
    line: { type: Object as PropType<ReviewLine>, required: true },
    /** The language the receipt is printed in, for the system's face to pick its glyphs. */
    lang: { type: String, required: true },
  },
  emits: { open: () => true },
  setup(props) {
    const { t, locale } = useI18n()
    const figures = computed(() => {
      const { quantity } = props.line
      const price = props.line.ownFigures ? null : props.line.line.price
      if (!quantity) return null
      const qty = `${formatQuantity(quantity, locale.value)} ${t(`item.unit_${quantity.unit}`)}`
      if (!price) return qty
      const discount = props.line.line.discount
      // A discount of nothing is printed by the till as «0,00»: no «− 0» after the price.
      return discount && discount.minor > 0n && !props.line.ownFigures
        ? t('receipt.review.qty_price_discount', {
            qty,
            price: formatMoney(price, locale.value),
            discount: formatMoney(discount, locale.value),
          })
        : t('receipt.review.qty_price', { qty, price: formatMoney(price, locale.value) })
    })
    const printed = computed(() =>
      props.line.line.sum ? formatMoney(props.line.line.sum, locale.value) : null,
    )
    const sum = computed(() =>
      props.line.amount ? formatMoney(props.line.amount, locale.value) : null,
    )
    const tags = computed(() => [
      ...(props.line.skip ? [{ key: 'skip', text: t('receipt.review.tag_skip') }] : []),
      ...(!props.line.skip && props.line.isNew
        ? [{ key: 'new', text: t('receipt.review.tag_new') }]
        : []),
      ...(!props.line.skip && props.line.check
        ? [{ key: 'check', text: t('receipt.review.tag_check') }]
        : []),
    ])
    const spoken = computed(() =>
      [
        t('receipt.review.line_aria', {
          name: props.line.name,
          qty: figures.value ?? '',
          sum: sum.value ?? '',
        }),
        ...tags.value.map((tag) => tag.text),
      ].join(', '),
    )
    return { t, figures, printed, sum, tags, spoken }
  },
})
</script>

<style scoped lang="scss">
.receipt-line {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
  width: 100%;
  padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
  border: 0;
  color: var(--text);
  background: var(--surface);
  text-align: left;
  font: inherit;
  cursor: pointer;

  &:hover {
    background: var(--surface-2);
  }

  &:focus-visible {
    @include focus-ring;
  }
}

.text {
  display: grid;
  flex: 1;
  gap: var(--space-1);
  min-width: 0;
}

.name {
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
  overflow-wrap: anywhere;
}

.printed {
  overflow: hidden;
  color: var(--text-muted);
  font-family: var(--font-printed);
  font-size: var(--text-footnote);
  line-height: var(--leading-body);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.figures {
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-variant-numeric: tabular-nums;
}

.mismatch {
  margin-left: var(--space-1);
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--warn-ink);
  background: var(--warn-tint);
  font-weight: var(--weight-medium);
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.tag {
  display: inline-flex;
  align-items: center;
  min-height: 1.5rem;
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);

  &.new {
    color: var(--text);
    background: var(--surface-2);
    box-shadow: inset 0 0 0 var(--hairline) var(--border-strong);
  }

  &.check {
    color: var(--warn-ink);
    background: var(--warn-tint);
  }

  &.skip {
    color: var(--text-muted);
    background: var(--surface-2);
  }
}

.sum {
  flex: none;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.chevron {
  @include icon;

  font-size: var(--icon);
  margin-top: var(--space-1);
  color: var(--text-muted);
}

.skipped {
  .name,
  .sum {
    color: var(--text-muted);
    text-decoration: line-through;
  }
}
</style>
