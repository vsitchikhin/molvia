<template>
  <AppCard v-if="form === 'rows'" as="ul" list>
    <li v-for="n in count" :key="n" class="item">
      <span class="row">
        <span class="circle"></span>
        <span class="words">
          <span class="line"><span class="bar title"></span></span>
          <span class="line small"><span class="bar meta"></span></span>
        </span>
        <span class="tail"
          ><span class="line"><span class="bar amount"></span></span
        ></span>
        <span class="chevron"></span>
      </span>
    </li>
  </AppCard>
  <div v-else class="cards">
    <div v-for="n in count" :key="n" class="entry">
      <span class="day"></span>
      <span class="sums"><span class="sum"></span><span class="sum"></span></span>
      <span v-if="plate" class="plate"></span>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import AppCard from '@/components/AppCard.vue'

/**
 * What is coming, drawn in the slot of `ScreenSkeleton` so the list does not jump when it arrives:
 *
 *   cards — the cards of exchanges or incomes: the day, the amounts, the plate (MOL-81, handoff 02);
 *   rows  — the rows of `OperationRow` (MOL-176): its height, its circle of `--row-circle`, its words
 *           and its amount where they will stand, in a list card — each bar in a line of the size and
 *           leading of the words it stands for, so a row is as tall as the answer's. Narrower than
 *           `$row-narrow` the amount goes under the words, as the row's does (adversarial round 3, В1).
 *           Bars of `border` on `surface` (Ф-13): `surface-2` is not seen on the page's ground.
 *           Screens take it with MOL-178.
 */
export default defineComponent({
  name: 'OperationSkeleton',
  components: { AppCard },
  props: {
    form: { type: String as PropType<'cards' | 'rows'>, default: 'cards' },
    count: { type: Number, default: 2 },
    /** An exchange always has its plate of rates; an income only sometimes. */
    plate: { type: Boolean, default: true },
  },
})
</script>

<style scoped lang="scss">
.cards {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* Not `.card`: the class would reach the root of `AppCard` of the rows, which carries this scope too. */
.entry {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--surface);
}

.day,
.sum,
.plate {
  display: block;
  border-radius: var(--radius-pill);
  background: var(--surface-2);
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
  height: var(--touch-target-lg);
  border-radius: var(--radius);
}

/* The geometry of `ListRow` with a tint and a chevron: 64, 12 / 16, the gaps of 12 — and its container
   `row`, which `OperationRow` sets on its `li`. */
.item {
  container: row / inline-size;
}

.row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  box-sizing: border-box;
  min-height: calc(var(--touch-target-lg) + var(--space-3));
  padding: var(--space-3) var(--space-4);
}

/* A bar stands in the middle of a line of the words it stands for — the title's and the amount's 17, the
   meta's 13 — as tall as their leading makes it: where the text's own box is centred. */
.line {
  display: flex;
  align-items: center;
  height: calc(1em * var(--leading-snug));
  font-size: var(--text-body);
}

.small {
  font-size: var(--text-footnote);
}

.circle,
.bar {
  display: block;
  border-radius: var(--radius-pill);
  background: var(--border);
}

.circle {
  flex: none;
  width: var(--row-circle);
  height: var(--row-circle);
}

.words {
  flex: 1;
  min-width: 0;
}

.title {
  width: 60%;
  height: var(--skeleton-line);
}

.meta {
  width: 40%;
  height: var(--skeleton-sub);
}

.tail {
  flex: none;
  width: 22%;
}

.amount {
  width: 100%;
  height: var(--skeleton-line);
}

/* The chevron's place, empty: the amounts end where the rows' will. */
.chevron {
  flex: none;
  width: var(--icon);
}

/* Narrow, as `ListRow` in its container: the amount on a line of its own under the words, at the right. */
@container row (width < #{$row-narrow}) {
  .row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 0 var(--space-3);
  }

  .circle {
    grid-row: 1 / span 2;
  }

  .words {
    grid-column: 2;
    grid-row: 1;
  }

  .tail {
    grid-column: 2;
    grid-row: 2;
    justify-self: end;
    width: 40%;
    margin-top: var(--space-1);
  }

  .chevron {
    grid-column: 3;
    grid-row: 1 / span 2;
  }
}
</style>
