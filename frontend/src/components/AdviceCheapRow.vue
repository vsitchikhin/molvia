<template>
  <button class="row" type="button" @click="$emit('edit')">
    <VerdictBadge level="if_cheap" compact />

    <span class="body">
      <span class="name">{{ row.name }}</span>
      <span v-if="second" class="second">{{ second }}</span>
    </span>

    <span class="figures">
      <span v-if="places.kind !== 'none'" class="price">{{ unitPrice(places.best) }}</span>
      <AdviceRating :rating="row.rating" :count="row.ratingsCount" />
    </span>
  </button>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatUnitPrice } from '@molvia/model'
import type { AdvicePlace } from '@molvia/model'
import AdviceRating from '@/components/AdviceRating.vue'
import VerdictBadge from '@/components/VerdictBadge.vue'
import { placesView } from '@/components/adviceRow'
import type { CheapRow } from '@/components/adviceRow'

/**
 * «Только если дёшево»: a row, not a card — the verdict decides how much matter a line gets,
 * and this one is worth less than a recommendation (MOL-32).
 *
 * The dashed edge is the third sign of «conditionally», independent of colour, after the shape
 * of the badge and its icon.
 *
 * **The second line is the threshold, and the place when there is no threshold** (В-2). The
 * lower median needs three purchases before it means anything (MOL-33), and until then the
 * server sends `null` rather than a number with nothing under it. A line that said nothing at
 * all in the meantime would leave the row without an answer to «where did I buy this», which
 * the card above always gives.
 */
export default defineComponent({
  name: 'AdviceCheapRow',
  components: { AdviceRating, VerdictBadge },
  props: {
    row: { type: Object as PropType<CheapRow>, required: true },
  },
  emits: {
    edit: () => true,
  },
  setup(props) {
    const { t, locale } = useI18n()

    const places = computed(() => placesView(props.row.places))

    function unitPrice(place: AdvicePlace): string {
      return t('item.unit_price_value', {
        amount: formatUnitPrice(place.unitPrice, locale.value),
        unit: t(`item.unit_${place.unitPrice.unit}`),
      })
    }

    const second = computed(() => {
      const threshold = props.row.threshold
      if (threshold) {
        return t('advice.threshold', {
          price: t('item.unit_price_value', {
            amount: formatUnitPrice(threshold, locale.value),
            unit: t(`item.unit_${threshold.unit}`),
          }),
        })
      }
      const view = places.value
      if (view.kind === 'none') return ''
      const key = view.kind === 'sole' ? 'advice.bought_at' : 'advice.cheapest_at'
      return t(key, { place: view.best.name })
    })

    return { places, second, unitPrice }
  },
})
</script>

<style scoped lang="scss">
.row {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  width: 100%;
  min-height: var(--touch-target);
  padding: var(--space-2) var(--space-3);
  border: var(--hairline) dashed var(--warn);
  border-radius: var(--radius);
  background: var(--surface);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;

  &:focus-visible {
    @include focus-ring;
  }
}

.row + .row {
  margin-top: var(--space-2);
}

.body {
  flex: 1;
  min-width: 0;
}

.name {
  display: block;
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
}

.second {
  display: block;
  color: var(--text-muted);
  font-size: var(--text-caption);
}

.figures {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: flex-end;
  text-align: right;
}

.price {
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
}
</style>
