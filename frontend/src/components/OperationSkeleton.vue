<template>
  <div class="skeleton-cards">
    <div v-for="(lines, n) in plates" :key="n" class="entry">
      <span class="head"><span class="day"></span></span>
      <span class="sums"><span class="sum"></span><span class="sum"></span></span>
      <span v-if="lines" class="plate" :class="{ double: lines > 1 }"></span>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'

/**
 * The cards of incomes that are coming, drawn in the slot of `ScreenSkeleton` so the list does not jump
 * when it arrives: the day, the source and the figure, the plate (MOL-81, MOL-188). Bars of
 * `skeleton-bar` (Ф-13). An exchange is a row of the kit since MOL-348 (`SkeletonPart kind="rows"`).
 */
export default defineComponent({
  name: 'OperationSkeleton',
  props: {
    /**
     * A card a value, the lines of its plate: one for its account or its note, two for both, none for
     * neither (MOL-188, Р-7, adversarial Б2).
     */
    plates: { type: Array as PropType<readonly number[]>, default: () => [1, 1] },
  },
})
</script>

<style scoped lang="scss">
// The root is the part's own, never a class a screen uses: a screen's scoped `.cards` landed on it and
// set the gap by the order the sheets load in (MOL-188, self-review №1). 8, as the cards of the answer.
.skeleton-cards {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.entry {
  display: flex;
  flex-direction: column;
  padding: var(--space-4);
  border: var(--hairline) solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);

  /* The card of the answer has its edge and shadow (`AppCard`), so the bars come in one (MOL-345, Ф-13). */
  box-shadow: var(--shadow-sm);
}

// The head of `OperationCardHead`: the day and the chevron of 20 on one line (MOL-189).
.head {
  display: flex;
  align-items: center;
  min-height: var(--icon);
}

.day,
.sum {
  @include skeleton-bar;
}

.day {
  width: 24%;
  height: var(--skeleton-line);
}

// `IncomeCard`: `OperationCardHead`, 8 under it the source and the figure at the body's leading, then 8
// and a plate of one line of the note in its padding.
.sums {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
  height: calc(var(--text-card-figure) * var(--leading-body));
  margin-top: var(--space-2);
}

.sum {
  width: 36%;
  height: var(--skeleton-line);
}

.plate {
  @include skeleton-bar;

  height: calc(var(--text-footnote) * var(--leading-body) + 2 * var(--space-2));
  margin-top: var(--space-2);
  border-radius: var(--radius);

  // The account and the note under a hairline, 8 above it and 8 under it.
  &.double {
    height: calc(
      2 * var(--text-footnote) * var(--leading-body) + 4 * var(--space-2) + var(--hairline)
    );
  }
}
</style>
