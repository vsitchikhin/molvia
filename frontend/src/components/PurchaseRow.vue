<template>
  <button class="purchase-row" type="button" @click="$emit('open')">
    <component :is="icon" v-if="icon" class="icon" :class="{ accent }" aria-hidden="true" />
    <span class="text">
      <span class="title">{{ title }}</span>
      <span v-if="meta" class="meta">{{ meta }}</span>
      <span v-if="note" class="note">{{ note }}</span>
    </span>
    <span v-if="sum" class="sum">{{ sum }}</span>
    <!-- Drawn as a button and read as part of the row: the row itself is the one control, and a
         button inside a button is not HTML. -->
    <span v-if="tag" class="tag">{{ tag }}</span>
    <IconChevronRight v-else class="chevron" aria-hidden="true" />
  </button>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { Component, PropType } from 'vue'
import IconChevronRight from '~icons/mdi/chevron-right'

/**
 * One row of «Покупки» (MOL-128): an icon, where, what and when, the sum on the right and a
 * chevron — or, for the record still being written, «Продолжить» in its place. The whole row is
 * the button, whatever it is labelled: the handoff's «Продолжить» does what a tap on the row does.
 *
 * Grew out of `TripHistoryRow` (MOL-77); the words are the screen's, so the same row serves a
 * record, a card of «ждут оценки» and, with MOL-127, a receipt.
 */
export default defineComponent({
  name: 'PurchaseRow',
  components: { IconChevronRight },
  props: {
    title: { type: String, required: true },
    meta: { type: String as PropType<string | null>, default: null },
    /** A second, quieter line — «запись ещё не ушла». */
    note: { type: String as PropType<string | null>, default: null },
    sum: { type: String as PropType<string | null>, default: null },
    icon: { type: Object as PropType<Component | null>, default: null },
    /** The icon in the accent: a row that asks for something to be done. */
    accent: { type: Boolean, default: false },
    /** A word in place of the chevron, drawn as a secondary button. */
    tag: { type: String as PropType<string | null>, default: null },
  },
  emits: { open: () => true },
})
</script>

<style scoped lang="scss">
.purchase-row {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  width: 100%;
  min-height: calc(var(--touch-target-lg) + var(--space-3));
  padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
  border: 0;
  color: var(--text);
  background: var(--surface);
  text-align: left;
  font: inherit;
  cursor: pointer;

  &:hover {
    background: var(--surface-2);
  }

  &:focus-visible {
    @include focus-ring;
  }
}

.icon {
  flex: none;
  width: 1.5rem;
  height: 1.5rem;
  color: var(--text-muted);

  &.accent {
    color: var(--accent-ink);
  }
}

.text {
  flex: 1;
  min-width: 0;
}

.title,
.meta,
.note {
  display: block;

  // A shop's name has no spaces to break at: cut by the card's edge it ran under the chevron
  // (MOL-77, round 4, Л1).
  overflow-wrap: anywhere;
}

.title {
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
}

.meta,
.note {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.sum {
  flex: none;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.tag {
  @include touch-target;

  flex: none;
  padding: 0 var(--space-3);
  border: var(--hairline) solid var(--border-strong);
  border-radius: var(--radius);
  color: var(--accent-ink);
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
}

.chevron {
  flex: none;
  width: 1.25rem;
  height: 1.25rem;
  color: var(--text-muted);
}
</style>
