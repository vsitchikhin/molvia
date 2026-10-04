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

  // What stands here comes in, «Вернуть» and the main action alike, each in place of the other.
  > :slotted(*) {
    @include appear;

    pointer-events: auto;
  }

  // An inactive action lies over the cards too, and without its lift it reads as a smudge on them
  // (handoff MOL-81, 02): the look is the kit's, the lift the dock's — by a weight above the kit's
  // light `box-shadow: none`, whatever order the two sheets come in (MOL-174, review 1).
  > :slotted([aria-disabled='true']:not([aria-busy='true'])),
  > :slotted(:disabled:not([aria-busy='true'])) {
    box-shadow: var(--shadow-md);
  }
}
</style>
