<template>
  <button class="row" type="button" @click="$emit('edit')">
    <span class="line">
      <span class="name">{{ row.name }}</span>
      <AdviceRating :rating="row.rating" :count="row.ratingsCount" />
    </span>
    <span v-if="row.review" class="review">{{ row.review }}</span>
  </button>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import AdviceRating from '@/components/AdviceRating.vue'
import type { NeverRow } from '@/components/adviceRow'

/**
 * «Не брать нигде»: a line of text, struck through, and nothing to be tempted by (MOL-32).
 *
 * **There is no price and no place here, and there is no field for either** — the row this
 * draws has none at all (MOL-31, Р-8). That is the point of the whole screen: cheapness cannot
 * pull a bad item into a recommendation, because in this group there is nothing to be cheap
 * with. A muted price would still be a price, and a dash in a price column is still a price
 * column.
 *
 * The rating stays: in the shared mode it is the only thing that explains «nowhere», and it is
 * what tells a lone bad experience from four people agreeing (В-3). The review is always the
 * asker's own — words are not an aggregate — and it explains the verdict better than any figure.
 */
export default defineComponent({
  name: 'AdviceNeverRow',
  components: { AdviceRating },
  props: {
    row: { type: Object as PropType<NeverRow>, required: true },
  },
  emits: {
    edit: () => true,
  },
})
</script>

<style scoped lang="scss">
.row {
  display: block;
  width: 100%;
  min-height: var(--touch-target);
  padding: var(--space-1);
  border: none;
  border-radius: var(--radius-sm);
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

.line {
  display: flex;
  gap: var(--space-3);
  align-items: baseline;
  justify-content: space-between;
}

.name {
  color: var(--text-muted);
  font-size: var(--text-callout);
  text-decoration: line-through;
}

.review {
  display: block;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-style: italic;
  line-height: var(--leading-snug);
}
</style>
