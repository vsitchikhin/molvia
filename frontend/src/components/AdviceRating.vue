<template>
  <span class="rating">{{ line }}</span>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatRating } from '@/components/adviceRow'

/**
 * «4,3 из 5 · 3 оценки» — the figure a verdict stands on, printed the same way by all three
 * forms of row (MOL-32).
 *
 * A component rather than three copies of one expression: the count beside the rating is what
 * says how much the figure is worth — one person's own score in the own mode, three or more in
 * the shared one — and the two are read together or not at all.
 */
export default defineComponent({
  name: 'AdviceRating',
  props: {
    /** A decimal string, as the contract carries it: «4.3». */
    rating: { type: String, required: true },
    count: { type: Number, required: true },
  },
  setup(props) {
    const { t, locale } = useI18n()

    const line = computed(() =>
      t('advice.rating_line', {
        rating: t('advice.rating', { value: formatRating(props.rating, locale.value) }),
        count: t('advice.ratings_count', { n: props.count }, props.count),
      }),
    )

    return { line }
  },
})
</script>

<style scoped lang="scss">
.rating {
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
