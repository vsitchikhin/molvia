<template>
  <component :is="as" class="card" :class="[tone, { list }]">
    <slot />
  </component>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'

/** Tags a card can be. Not a button and not a link: a card is a surface, never a control. */
const TAGS = ['div', 'ul', 'ol', 'article', 'section'] as const
export type CardTag = (typeof TAGS)[number]

/**
 * The surface the lists and blocks of 0.1 are built from: the trip's list of items, the verdict
 * card, the «Take» card of «What to buy».
 *
 * The three share only the surface; each has its own tag, padding and edge. The owner chose a
 * component over a mixin (MOL-18, В-1) with that price in view, so it carries exactly the
 * differences between them and nothing for later:
 *
 *   as    — the tag, chosen by the screen, which knows what the content means;
 *   tone  — `take` is the verdict «take» coming from the data: a green edge and a tighter
 *           radius. It is not emphasis and not a place in the results; there is no other tone
 *           and none is to be added;
 *   list  — rows edge to edge with a hairline between them, and no padding of its own.
 *
 * A padding of its own — the verdict card's 24 / 16 — comes from the screen's class, which Vue
 * puts on this root.
 */
export default defineComponent({
  name: 'AppCard',
  props: {
    as: {
      type: String as PropType<CardTag>,
      default: 'div',
      validator: (tag: string) => (TAGS as readonly string[]).includes(tag),
    },
    tone: { type: String as PropType<'plain' | 'take'>, default: 'plain' },
    list: { type: Boolean, default: false },
  },
})
</script>

<style scoped lang="scss">
.card {
  margin: 0;
  padding: var(--space-4);
  border: var(--hairline) solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.take {
  border-color: var(--good);
  border-radius: var(--radius);
}

.list {
  padding: 0;
  overflow: hidden;
  list-style: none;

  > :deep(* + *) {
    border-top: var(--hairline) solid var(--border);
  }

  /* The list clips its rows to its radius, and a ring drawn outside a row would be cut on three
     sides — a row that is tapped has to show its focus inside (review Р-4). */
  :deep(:focus-visible) {
    outline-offset: -2px;
  }
}
</style>
