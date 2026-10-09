<template>
  <ScreenSkeleton>
    <!-- «Куда ушли» is the charts' own: its caption, the ring of 212 and the legend's rows. -->
    <AppCard class="ghost-donut">
      <span class="ghost-heading"><span class="ghost-bar ghost-caption"></span></span>
      <span class="ghost-ring"></span>
      <span class="ghost-legend">
        <span v-for="n in 3" :key="n" class="ghost-row">
          <span class="ghost-dot"></span>
          <span class="ghost-bar ghost-name"></span>
          <span class="ghost-bar ghost-amount"></span>
        </span>
      </span>
    </AppCard>
    <!-- The card after it: «Против обычного» of a month, the bars of «Расходы по месяцам» of a year. -->
    <AppCard class="ghost-next">
      <span class="ghost-heading"><span class="ghost-bar ghost-caption"></span></span>
      <template v-if="year">
        <span class="ghost-bar ghost-label"></span>
        <span class="ghost-bar ghost-figure"></span>
        <span class="ghost-bars">
          <span v-for="n in 12" :key="n" class="ghost-column"></span>
        </span>
      </template>
      <span v-else class="ghost-lines">
        <span v-for="n in 4" :key="n" class="ghost-bar ghost-line"></span>
      </span>
    </AppCard>
  </ScreenSkeleton>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import AppCard from '@/components/AppCard.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'

/**
 * Loading of «Графики» in the shape of its answer (Ф-13, MOL-178, handoff MOL-157 v2 5a): the card of
 * the ring, as large as the ring that comes, and the card that stands after it — the lines of «Против
 * обычного» on «Месяц», twelve bars on «Год». Bars of `skeleton-bar`, as every screen's own part.
 */
export default defineComponent({
  name: 'ChartsSkeleton',
  components: { AppCard, ScreenSkeleton },
  props: {
    /** «Год»: the card after the ring is twelve bars, not lines. */
    year: { type: Boolean, default: false },
  },
})
</script>

<style scoped lang="scss">
.ghost-donut,
.ghost-next {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
}

/* 24 between the cards, as between the cards of the answer (Ф-10): the frame puts 8. */
.ghost-next {
  margin-top: var(--space-4);
}

.ghost-heading {
  display: flex;
  align-items: center;
  height: calc(1em * var(--leading-body));
  font-size: var(--text-callout);
}

.ghost-bar {
  @include skeleton-bar;

  height: var(--skeleton-caption);
}

.ghost-caption {
  width: 30%;
}

/* The ring of `DonutChart`: 212, its band 12 of the hundred. */
.ghost-ring {
  @include skeleton-bar;

  width: 13.25rem;
  height: 13.25rem;
  margin: 0 auto;
  border-radius: 50%;
  background: none;
  box-shadow: inset 0 0 0 1.59rem var(--border-strong);
}

.ghost-legend {
  display: grid;
}

.ghost-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--touch-target);
  padding: 0 var(--space-2);
}

.ghost-dot {
  @include skeleton-bar;

  width: 0.75rem;
  height: 0.75rem;
  border-radius: 50%;
}

.ghost-name {
  flex: 1;
  max-width: 45%;
  height: var(--skeleton-line);
}

.ghost-amount {
  width: 22%;
  height: var(--skeleton-line);
  margin-left: auto;
}

.ghost-lines {
  display: grid;
  gap: var(--space-4);
}

.ghost-line {
  height: var(--skeleton-line);

  &:nth-child(2) {
    width: 72%;
  }

  &:nth-child(3) {
    width: 86%;
  }

  &:nth-child(4) {
    width: 54%;
  }
}

.ghost-label {
  width: 28%;
  height: var(--skeleton-line);
}

.ghost-figure {
  width: 46%;
  height: var(--skeleton-figure);
}

.ghost-bars {
  display: flex;
  align-items: flex-end;
  gap: var(--space-1);
  height: 9.375rem;
}

.ghost-column {
  @include skeleton-bar;

  flex: 1;
  height: 55%;
  border-radius: var(--radius-sm) var(--radius-sm) var(--radius-mark) var(--radius-mark);

  &:nth-child(3n) {
    height: 70%;
  }

  &:nth-child(4n) {
    height: 40%;
  }
}
</style>
