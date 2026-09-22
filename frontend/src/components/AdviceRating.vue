<template>
  <span class="rating">{{ line }}</span>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AdviceScope } from '@molvia/model'
import { formatRating } from '@/components/adviceRow'

/**
 * «4,3 из 5 · 3 оценки» — the figure a verdict stands on, printed the same way by all three
 * forms of row (MOL-32).
 *
 * A component rather than three copies of one expression: the count beside the rating is what
 * says how much the figure is worth — one person's own score in the own mode, three or more in
 * the shared one — and the two are read together or not at all.
 *
 * **In the own mode the count is left out** (MOL-32, МР-12): there it is always one, so «· 1
 * оценка» stood at the end of every row on the screen while the subtitle above already said
 * «Пока только ваши оценки». In the shared mode it is the whole point of the figure — and a
 * row that falls back to one's own numbers there says «1 оценка» meaning «this one is just
 * you», which is exactly what has to be readable.
 */
export default defineComponent({
  name: 'AdviceRating',
  props: {
    /** A decimal string, as the contract carries it: «4.3». */
    rating: { type: String, required: true },
    count: { type: Number, required: true },
    scope: { type: String as PropType<AdviceScope>, required: true },
  },
  setup(props) {
    const { t, locale } = useI18n()

    const line = computed(() => {
      const rating = t('advice.rating', { value: formatRating(props.rating, locale.value) })
      if (props.scope === 'own') return rating
      return t('advice.rating_line', {
        rating,
        count: t('advice.ratings_count', { n: props.count }, props.count),
      })
    })

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
