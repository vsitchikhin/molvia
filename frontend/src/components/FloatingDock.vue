<template>
  <div class="dock" :class="{ bare: !route.meta.tab }">
    <slot />
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useRoute } from 'vue-router'

/**
 * Where the main action of a «Деньги» screen floats: right, over the tab bar, under the thumb —
 * «Трата», «Обмен», «Доход» (MOL-72, MOL-81). A place and not a button: on the month the same spot
 * holds «Вернуть» after a removal, and the screen decides which of the two stands there. Only what
 * it holds takes taps; the rest of its row lets them through to the list underneath. Over the tab
 * bar on a section, at the bottom edge on a nested screen, which has none (MOL-17) — and above the
 * screen's pinned strip, by its height, when a new version waits there (MOL-132).
 */
export default defineComponent({
  name: 'FloatingDock',
  setup() {
    return { route: useRoute() }
  },
})
</script>

<style scoped lang="scss">
.dock {
  position: fixed;
  right: calc(var(--space-4) + var(--safe-right));

  // Above the screen's pinned strip, when it has one — a new version waiting (MOL-132).
  bottom: calc(var(--tabbar-height) + var(--safe-bottom) + var(--dock-height) + var(--space-4));
  left: calc(var(--space-4) + var(--safe-left));
  z-index: 1;
  display: flex;
  justify-content: flex-end;
  pointer-events: none;

  &.bare {
    bottom: calc(var(--safe-bottom) + var(--dock-height) + var(--space-4));
  }

  > :slotted(*) {
    pointer-events: auto;
  }

  // An inactive action lies over the cards, and half-transparent it reads as a smudge on them:
  // drawn solid and muted instead — the strip above says why (handoff MOL-81, 02).
  > :slotted([aria-disabled='true']:not([aria-busy='true'])) {
    background: var(--surface-2);
    color: var(--text-muted);
    opacity: 1;
  }
}
</style>
