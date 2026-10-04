<template>
  <fieldset class="chips-field" :aria-describedby="error ? errorId : undefined">
    <legend class="legend">{{ legend }}</legend>
    <div class="chips" :class="{ bad: !!error }">
      <label
        v-for="category in categories"
        :key="category.id"
        class="chip"
        :class="{ on: category.id === modelValue }"
      >
        <input
          class="radio"
          type="radio"
          :name="name"
          :value="category.id"
          :checked="category.id === modelValue"
          :aria-invalid="error ? 'true' : undefined"
          @change="$emit('update:modelValue', category.id)"
        />
        <span class="dot" :style="{ background: colourOf(category) }" aria-hidden="true"></span>
        {{ nameOf(category) }}
      </label>
      <button type="button" class="chip add" @click="$emit('add')">
        <IconPlus class="plus" aria-hidden="true" />{{ addLabel }}
      </button>
    </div>
    <AppReveal>
      <p v-if="error" :id="errorId" class="error">
        <IconAlert class="alert" aria-hidden="true" />{{ error }}
      </p>
    </AppReveal>
  </fieldset>
</template>

<script lang="ts">
import { defineComponent, useId } from 'vue'
import type { PropType } from 'vue'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconPlus from '~icons/mdi/plus'
import type { SpendingCategoryView } from '@molvia/model'
import AppReveal from '@/components/AppReveal.vue'
import { categoryColour } from '@/components/spending'

/**
 * The categories of a spending as chips (MOL-82, handoff 02): radios in a fieldset, so arrows move
 * the choice and the group is read by its legend. Nothing is chosen until the person chooses —
 * guessing a category is not allowed — and the order is fixed, never by frequency: a chip must not
 * move from under the finger. Chosen is «here», the accent, not the category's colour — a fill and
 * a ring, never a weight: every chip is at 600, so the row does not reflow on a tap (Ф-5, MOL-174).
 * The last chip makes a category of one's own (В-1).
 */
export default defineComponent({
  name: 'CategoryChips',
  components: { AppReveal, IconAlert, IconPlus },
  props: {
    modelValue: { type: String as PropType<string | null>, default: null },
    categories: { type: Array as PropType<SpendingCategoryView[]>, required: true },
    nameOf: {
      type: Function as PropType<(category: SpendingCategoryView) => string>,
      required: true,
    },
    legend: { type: String, required: true },
    addLabel: { type: String, required: true },
    error: { type: String as PropType<string | null>, default: null },
  },
  emits: ['update:modelValue', 'add'],
  setup() {
    return { name: useId(), errorId: useId(), colourOf: categoryColour }
  },
})
</script>

<style scoped lang="scss">
.chips-field {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.legend {
  margin-bottom: var(--space-2);
  padding: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--touch-target);
  padding: 0 var(--space-4) 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  box-shadow: inset 0 0 0 var(--hairline) var(--border-strong);
  color: var(--text);
  font: inherit;
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);

  &.on {
    background: var(--accent-tint);
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  &:has(.radio:focus-visible),
  &.add:focus-visible {
    @include focus-ring;
  }
}

.bad .chip:not(.add, .on) {
  box-shadow: inset 0 0 0 var(--hairline) var(--bad);
}

.radio {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.dot {
  flex: none;
  width: 0.625rem;
  height: 0.625rem;
  border-radius: var(--radius-pill);
}

.add {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--border-strong);
  color: var(--accent-ink);
  font-weight: var(--weight-bold);
}

.plus {
  @include icon;

  font-size: var(--icon-sm);
}

.error {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin: var(--space-2) 0 0;
  color: var(--bad-ink);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.alert {
  @include icon;

  font-size: var(--icon-sm);
}

@media (prefers-reduced-motion: reduce) {
  .chip {
    transition: none;
  }
}
</style>
