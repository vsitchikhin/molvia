<template>
  <div>
    <div class="scale" role="group" :aria-label="t('verdict.scale_group')">
      <button
        v-for="value in SCORES"
        :key="value"
        class="key"
        type="button"
        :aria-pressed="modelValue === value ? 'true' : 'false'"
        :aria-label="t('verdict.scale_label', { n: value })"
        @click="choose(value)"
      >
        {{ value }}
      </button>
    </div>
    <div class="ends" aria-hidden="true">
      <span>{{ t('verdict.scale_low') }}</span>
      <span>{{ t('verdict.scale_high') }}</span>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { SCORES } from '@/components/rating'
import type { Score } from '@/components/rating'

/**
 * The 1–5 scale, wherever a verdict is given or changed: the queue of «Оценки» (MOL-28) and
 * the sheet of «Что брать» (MOL-32).
 *
 * Digits, not stars: five stars are hard to hit with a thumb and read as decoration, while
 * here the score is the whole entry into a verdict. A second tap on the chosen digit takes it
 * back — the only way to undo a mis-tap on a scale that has no «none».
 */
export default defineComponent({
  name: 'RatingScale',
  props: {
    modelValue: { type: Number as PropType<Score | null>, default: null },
  },
  emits: {
    'update:modelValue': (score: Score | null) =>
      score === null || (SCORES as readonly number[]).includes(score),
  },
  setup(props, { emit }) {
    const { t } = useI18n()

    function choose(value: Score): void {
      emit('update:modelValue', props.modelValue === value ? null : value)
    }

    return { t, SCORES, choose }
  },
})
</script>

<style scoped lang="scss">
.scale {
  display: flex;
  gap: var(--space-2);
  justify-content: space-between;
}

.key {
  flex: 1;
  min-height: var(--rating-key);
  border: var(--hairline) solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text);
  font-family: var(--font);
  font-size: var(--text-body);
  font-variant-numeric: tabular-nums;
  font-weight: var(--weight-bold);
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
  -webkit-tap-highlight-color: transparent;

  &[aria-pressed='true'] {
    border-color: var(--accent-solid);
    background: var(--accent-solid);
    color: var(--on-accent);
  }

  &:focus-visible {
    @include focus-ring;
  }
}

.ends {
  display: flex;
  justify-content: space-between;
  margin-top: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-caption);
}

@media (prefers-reduced-motion: reduce) {
  .key {
    transition: none;
  }
}
</style>
