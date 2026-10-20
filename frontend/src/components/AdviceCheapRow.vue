<template>
  <button class="row" type="button" @click="$emit('edit')">
    <span class="hidden">{{ t('advice.edit_action') }}</span>
    <VerdictBadge level="if_cheap" compact />

    <span class="body">
      <span class="title">
        <span class="name">{{ row.name }}</span>
        <AdviceRating :rating="row.rating" :count="row.ratingsCount" :scope="scope" />
      </span>
      <span v-if="at" class="at">{{ at }}</span>
      <span v-if="threshold" class="threshold">{{ threshold }}</span>
    </span>
  </button>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { cityWhereNameRepeats } from '@molvia/model'
import type { AdvicePlace, AdviceScope } from '@molvia/model'
import AdviceRating from '@/components/AdviceRating.vue'
import VerdictBadge from '@/components/VerdictBadge.vue'
import { placesView, unitPriceText } from '@/components/adviceRow'
import { placeLabel } from '@/components/placeLabel'
import type { CheapRow } from '@/components/adviceRow'

/**
 * «Только если дёшево»: a row, not a card — the verdict decides how much matter a line gets,
 * and this one is worth less than a recommendation (MOL-32).
 *
 * The dashed edge is the third sign of «conditionally», independent of colour, after the shape
 * of the badge and its icon.
 *
 * **The price and its place first, the threshold under them** (MOL-200, Ф-21): «1 290 ֏/кг ·
 * Ереван Сити», then «Стоит брать дешевле 1 100 ֏/кг». The place used to stand only where there
 * was no threshold, so a row that had one never said where it was bought. Either line is left
 * out when there is nothing to say: the lower median needs three purchases before it means
 * anything (MOL-33), and a row rated but never bought has no place.
 *
 * **No word before the place.** One place is named, and «price · place» says nothing about the
 * others, so the superlative the card above decides (А1) has nothing to be true or false of here.
 */
export default defineComponent({
  name: 'AdviceCheapRow',
  components: { AdviceRating, VerdictBadge },
  props: {
    row: { type: Object as PropType<CheapRow>, required: true },
    /** Whose figures the row carries: in the own mode the count of one is not worth printing. */
    scope: { type: String as PropType<AdviceScope>, required: true },
  },
  emits: {
    edit: () => true,
  },
  setup(props) {
    const i18n = useI18n()
    const { t, locale } = i18n

    const places = computed(() => placesView(props.row.places))
    // A place is named with its city where another place of the row shares its name (MOL-120).
    const cityOf = computed(() => cityWhereNameRepeats(props.row.places))
    const named = (place: AdvicePlace): string => placeLabel(place.name, cityOf.value(place), i18n)

    const at = computed(() => {
      const view = places.value
      if (view.kind === 'none') return ''
      return t('advice.price_at', {
        price: unitPriceText(view.best.unitPrice, t, locale.value),
        place: named(view.best),
      })
    })

    const threshold = computed(() => {
      const price = props.row.threshold
      return price ? t('advice.threshold', { price: unitPriceText(price, t, locale.value) }) : ''
    })

    return { t, at, threshold }
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
  padding: var(--space-3);
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

.hidden {
  @include visually-hidden;
}

.body {
  flex: 1;
  min-width: 0;
}

.title {
  @include name-beside-figure;
}

.name {
  font-size: var(--text-body);
  font-weight: var(--weight-medium);
}

.at,
.threshold {
  display: block;
  font-size: var(--text-footnote);
}

.at {
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
}

.threshold {
  color: var(--text-muted);
}
</style>
