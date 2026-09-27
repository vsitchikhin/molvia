<template>
  <div class="cards">
    <div v-for="n in count" :key="n" class="card">
      <span class="day"></span>
      <span class="sums"><span class="sum"></span><span class="sum"></span></span>
      <span v-if="plate" class="plate"></span>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'

/**
 * The cards of exchanges or incomes that are coming, drawn in the slot of `ScreenSkeleton` — the
 * day, the amounts, the plate — so the list does not jump when they arrive (MOL-81, handoff 02).
 */
export default defineComponent({
  name: 'OperationSkeleton',
  props: {
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

.card {
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
</style>
