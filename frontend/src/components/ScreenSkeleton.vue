<template>
  <div class="skeleton" aria-busy="true">
    <p class="hidden" role="status">{{ t('state.loading') }}</p>

    <div class="bars" aria-hidden="true">
      <div v-for="(width, index) in groups" :key="index" class="group">
        <span class="line" :style="{ width: `${width}%` }"></span>
        <span class="sub"></span>
      </div>
      <slot />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'

function isWidths(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((width) => typeof width === 'number' && width > 0 && width <= 100)
  )
}

/**
 * Loading drawn as the content that is coming, not as a spinner: the screen must not jump
 * when the data arrives. The screen gives the geometry — one width per group, in percent,
 * deliberately uneven, since an even skeleton reads as a broken layout — and the block gives
 * the bars: a line and the shorter one under it.
 *
 * What is not a pair of bars — the five squares of the rating scale — goes into the slot and
 * breathes with the rest.
 */
export default defineComponent({
  name: 'ScreenSkeleton',
  props: {
    groups: {
      type: Array as PropType<number[]>,
      required: true,
      validator: isWidths,
    },
  },
  setup() {
    const { t } = useI18n()
    return { t }
  },
})
</script>

<style scoped lang="scss">
.hidden {
  @include visually-hidden;
}

.bars {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  animation: pulse var(--dur-pulse) ease-in-out infinite;
}

.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.line,
.sub {
  display: block;
  border-radius: var(--radius-pill);
  background: var(--surface-2);
}

.line {
  height: var(--skeleton-line);
}

.sub {
  width: 38%;
  height: var(--skeleton-sub);
  opacity: 0.6;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.45;
  }

  50% {
    opacity: 0.9;
  }
}

@media (prefers-reduced-motion: reduce) {
  .bars {
    animation: none;
  }
}
</style>
