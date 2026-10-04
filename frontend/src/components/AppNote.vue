<template>
  <div class="note" :class="tone">
    <component :is="glyph" class="icon" aria-hidden="true" />
    <div class="words"><slot /></div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { Component, PropType } from 'vue'
import IconInfo from '~icons/mdi/information-outline'

/**
 * A note (MOL-175, beyond FIXES: seven handoffs drew it, each its own way): an icon of 18 and words of
 * 13 on `surface-2` — never on `accent-tint`, which is for what is pressed (Ф-4). `warn` is a note
 * that asks to be read: «города нет в списке». The shape is the strip's (radius 14, 8 / 12); the fill
 * and the words tell them apart.
 *
 * No live region: what comes and goes on a screen is said by the one polite region of `App.vue`. The
 * words may hold a link or a button.
 */
export default defineComponent({
  name: 'AppNote',
  props: {
    tone: { type: String as PropType<'plain' | 'warn'>, default: 'plain' },
    icon: { type: [Object, Function] as PropType<Component>, default: undefined },
  },
  setup(props) {
    return { glyph: computed(() => props.icon ?? IconInfo) }
  },
})
</script>

<style scoped lang="scss">
.note {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: var(--text-footnote);
  line-height: var(--leading-snug);
}

.icon {
  @include icon;

  font-size: var(--icon-sm);
}

.words {
  flex: 1;
  min-width: 0;

  > :deep(p) {
    margin: 0;
  }
}

.warn {
  background: var(--warn-tint);
  color: var(--warn-ink);
}
</style>
