<template>
  <span class="head">
    <span class="day">{{ day }}</span>
    <span v-if="amended" class="amended">{{ amended }}</span>
    <IconChevronRight class="chevron" aria-hidden="true" />
  </span>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import IconChevronRight from '~icons/mdi/chevron-right'

/**
 * «When» of an operation's card — the day, «исправлен …», the chevron — the same on an exchange and an
 * income (MOL-81, handoff 02, 03). Inside the card's button: the whole card opens the amendment, and the
 * removal lives in its sheet (MOL-189, Ф-34, С-20). A `span`, since a button holds phrasing content only.
 */
export default defineComponent({
  name: 'OperationCardHead',
  components: { IconChevronRight },
  props: {
    day: { type: String, required: true },
    amended: { type: String as PropType<string | null>, default: null },
  },
})
</script>

<style scoped lang="scss">
.head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--icon);
}

.day {
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-bold);
}

.amended {
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

// The row's chevron, 20 everywhere (MOL-173): the card opens something to go on with.
.chevron {
  @include icon;

  margin-left: auto;
  font-size: var(--icon);
  color: var(--text-muted);
}
</style>
