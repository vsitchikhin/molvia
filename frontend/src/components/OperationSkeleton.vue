<template>
  <div class="skeleton-cards" :class="`skeleton-${form}`">
    <div v-for="(plate, n) in plates" :key="n" class="entry">
      <span class="head"><span class="day"></span></span>
      <span class="sums"><span class="sum"></span><span class="sum"></span></span>
      <span v-if="plate" class="plate"></span>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'

/**
 * The cards of exchanges or incomes that are coming, drawn in the slot of `ScreenSkeleton` so the list
 * does not jump when it arrives: the day, the amounts, the plate (MOL-81, handoff 02). Bars of
 * `skeleton-bar` (Ф-13). The rows of an operation are the kit's (`SkeletonPart kind="rows"`, MOL-178).
 */
export default defineComponent({
  name: 'OperationSkeleton',
  props: {
    /**
     * A card a value, whether it has its plate: an exchange always has its plate of rates, an income
     * only with an account or a note — so «Доходы» draw one with and one without (MOL-188, Р-7).
     */
    plates: { type: Array as PropType<readonly boolean[]>, default: () => [true, true] },
    /**
     * Whose card: an income's is as tall as `IncomeCard` — the head of the bin, the line of its figure, a
     * plate of one line of the note (MOL-188, adversarial А2: drawn as an exchange's, the second month
     * came 120 px below its bars).
     */
    form: {
      type: String as PropType<'exchange' | 'income'>,
      default: 'exchange',
      validator: (form: string) => form === 'exchange' || form === 'income',
    },
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
  gap: var(--space-3);
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--surface);
}

.head {
  display: flex;
}

.day,
.sum {
  @include skeleton-bar;
}

.day {
  width: 24%;
  height: var(--skeleton-sub);
}

.sums {
  display: flex;
  justify-content: space-between;
  gap: var(--space-6);
}

.sum {
  width: 36%;
  height: var(--skeleton-line);
}

.plate {
  @include skeleton-bar;

  height: var(--touch-target-lg);
  border-radius: var(--radius);
}

// `IncomeCard`: `OperationCardHead` — the bin's 44 and 4 above it — and right under it the source and
// the figure at the body's leading, then 8 and a plate of one line of the note in its padding.
.skeleton-income {
  .entry {
    gap: 0;
    padding: 0 var(--space-4) var(--space-4);
  }

  .head {
    align-items: center;
    min-height: calc(var(--touch-target) + var(--space-1));
    padding-top: var(--space-1);
  }

  .sums {
    align-items: center;
    height: calc(var(--text-card-figure) * var(--leading-body));
  }

  .plate {
    height: calc(var(--text-footnote) * var(--leading-body) + 2 * var(--space-2));
    margin-top: var(--space-2);
  }
}
</style>
