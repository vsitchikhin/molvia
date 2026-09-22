<template>
  <AppCard as="article" tone="take" class="card">
    <button class="tap" type="button" @click="$emit('edit')">
      <span class="hidden">{{ t('advice.edit_action') }}</span>
      <span class="head">
        <VerdictBadge level="take" />
        <AdviceRating :rating="row.rating" :count="row.ratingsCount" :scope="scope" />
      </span>

      <span class="name">{{ row.name }}</span>

      <template v-if="places.kind !== 'none'">
        <span class="best">
          <span class="where">{{ where }}</span>
          <span class="price">{{ unitPrice(places.best) }}</span>
        </span>
        <span v-if="places.rest.length > 0" class="more">{{ also }}</span>
      </template>
    </button>
  </AppCard>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AdvicePlace, AdviceScope } from '@molvia/model'
import AdviceRating from '@/components/AdviceRating.vue'
import AppCard from '@/components/AppCard.vue'
import VerdictBadge from '@/components/VerdictBadge.vue'
import { placesView, unitPriceText, whereKey } from '@/components/adviceRow'
import type { TakeRow } from '@/components/adviceRow'

/**
 * «Брать»: the densest of the three forms, because this is the row a person acts on — the
 * verdict, the figure it stands on, the name, where it is cheapest and at what price per unit
 * (MOL-32).
 *
 * Nothing here marks one shop out: no logo, no accent colour, no order but the price. Terracotta
 * means «tap this», and in a list of results it reads as a promoted place — there are no paid
 * placements, ever. The green is the verdict's own and comes from the data.
 *
 * A row rated but never bought has no price block at all rather than an empty one: there is
 * nothing to compare, and an empty block would say there is.
 */
export default defineComponent({
  name: 'AdviceTakeCard',
  components: { AdviceRating, AppCard, VerdictBadge },
  props: {
    row: { type: Object as PropType<TakeRow>, required: true },
    /** Whose figures the row carries: in the own mode the count of one is not worth printing. */
    scope: { type: String as PropType<AdviceScope>, required: true },
  },
  emits: {
    edit: () => true,
  },
  setup(props) {
    const { t, locale } = useI18n()

    const places = computed(() => placesView(props.row.places))

    const unitPrice = (place: AdvicePlace): string =>
      unitPriceText(place.unitPrice, t, locale.value)

    // The word is «Дешевле всего» only where that is true: the places come own city first,
    // then by price (Р-26), so the named one is not always the cheapest (MOL-32, А1). How many
    // there are, and which of them is dearest, is visible to the screen alone (MOL-34).
    const where = computed(() => {
      const view = places.value
      if (view.kind === 'none') return ''
      return t(whereKey(view), { place: view.best.name })
    })

    const also = computed(() => {
      const view = places.value
      if (view.kind === 'none') return ''
      const rest = view.rest.map((place) =>
        t('advice.also_place', { place: place.name, price: unitPrice(place) }),
      )
      return t('advice.also_at', { places: rest.join(' · ') })
    })

    return { t, places, where, also, unitPrice }
  },
})
</script>

<style scoped lang="scss">
.card {
  display: block;
  padding: 0;
}

.hidden {
  @include visually-hidden;
}

/* The whole card is the tap: a verdict is amended where it is met (MOL-32, В-1). */
.tap {
  display: block;
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: none;
  border-radius: inherit;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;

  &:focus-visible {
    @include focus-ring;
  }
}

.card + .card {
  margin-top: var(--space-3);
}

.head {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin-bottom: var(--space-2);
}

.name {
  display: block;
  font-family: var(--font-display);
  font-size: var(--text-title);
  font-weight: var(--weight-bold);
  line-height: var(--leading-tight);
}

.best {
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
  justify-content: space-between;
  margin-top: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--good-tint);
}

.where {
  color: var(--good-ink);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.price {
  flex: none;
  color: var(--good-ink);
  font-size: var(--text-callout);
  font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;
}

.more {
  display: block;
  margin-top: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-caption);
}
</style>
