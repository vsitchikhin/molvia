<template>
  <div class="head">
    <span class="day">{{ day }}</span>
    <span v-if="amended" class="amended">{{ amended }}</span>
    <button
      class="remove"
      type="button"
      :disabled="disabled"
      :aria-label="removeLabel"
      @click="$emit('remove')"
    >
      <IconDelete aria-hidden="true" />
    </button>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import IconDelete from '~icons/mdi/trash-can-outline'

/**
 * «When» of an operation's card — the day, «исправлен …», the bin — the same on an exchange and an
 * income (MOL-81, handoff 02, 03). Outside the card's body: the body is the way into the amendment,
 * and a bin inside a button is a button inside a button.
 */
export default defineComponent({
  name: 'OperationCardHead',
  components: { IconDelete },
  props: {
    day: { type: String, required: true },
    amended: { type: String as PropType<string | null>, default: null },
    /** The bin's name says which operation it removes — the icon alone says nothing. */
    removeLabel: { type: String, required: true },
    disabled: { type: Boolean, default: false },
  },
  emits: { remove: () => true },
})
</script>

<style scoped lang="scss">
.head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: calc(var(--touch-target) + var(--space-1));
  padding: var(--space-1) var(--space-1) 0 var(--space-4);
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

.remove {
  @include touch-target;

  flex: none;
  justify-content: center;
  width: var(--touch-target);
  margin-left: auto;
  border: 0;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text);
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--surface-2);
  }

  &:focus-visible {
    @include focus-ring;
  }

  /* The pair of the kit's icon button (В-15): live in `text`, not now in `text-muted` — no opacity. */
  &:disabled {
    color: var(--text-muted);
    cursor: default;
  }

  svg {
    @include icon;

    font-size: var(--icon-md);
  }
}
</style>
