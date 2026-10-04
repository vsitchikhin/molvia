<template>
  <AppCard v-if="form === 'rows'" as="ul" list>
    <li v-for="n in count" :key="n" class="row">
      <span class="circle"></span>
      <span class="words"><span class="title"></span><span class="meta"></span></span>
      <span class="amount"></span>
      <span class="chevron"></span>
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
 *           and its amount where they will stand, in a list card. Bars of `border` on `surface`
 *           (Ф-13): `surface-2` is not seen on the page's ground. Screens take it with MOL-178.
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

/* The geometry of `ListRow` with a tint and a chevron: 64, 12 / 16, the gaps of 12. */
.row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  box-sizing: border-box;
  min-height: calc(var(--touch-target-lg) + var(--space-3));
  padding: var(--space-3) var(--space-4);
}

.circle,
.title,
.meta,
.amount {
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
  display: grid;
  flex: 1;
  gap: var(--space-2);
}

.title {
  width: 60%;
  height: var(--skeleton-line);
}

.meta {
  width: 40%;
  height: var(--skeleton-sub);
}

.amount {
  width: 22%;
  height: var(--skeleton-line);
}

/* The chevron's place, empty: the amounts end where the rows' will. */
.chevron {
  flex: none;
  width: var(--icon);
}
</style>
