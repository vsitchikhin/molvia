<template>
  <div>
    <!-- The score as it stands, kept while another digit is chosen: the point a change is made
         from (Ф-25, С-9). The messages are the app's one global scope; unnamed, intlify warned at
         every mount. -->
    <I18nT v-if="current !== null" keypath="verdict.current" scope="global" tag="p" class="current">
      <template #n>
        <b>{{ current }}</b>
      </template>
    </I18nT>
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
import { Translation, useI18n } from 'vue-i18n'
import { SCORES } from '@/components/rating'
import type { Score } from '@/components/rating'

/**
 * The 1–5 scale, wherever a verdict is given or changed: the queue of «Оценки» (MOL-28) and
 * the sheet of «Что брать» (MOL-32).
 *
 * Digits, not stars: five stars are hard to hit with a thumb and read as decoration, while
 * here the score is the whole entry into a verdict. A second tap on the chosen digit takes it
 * back — the only way to undo a mis-tap on a scale that has no «none».
 *
 * `current` is the person's score as it stands — «Ваша оценка: N» over the keys (MOL-214, Ф-25):
 * on the sheet the row's own score, in the queue the one a card came back refused with. It only
 * says it; which digit is chosen is still the caller's `v-model`.
 */
export default defineComponent({
  name: 'RatingScale',
  components: { I18nT: Translation },
  props: {
    modelValue: { type: Number as PropType<Score | null>, default: null },
    current: { type: Number as PropType<Score | null>, default: null },
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
.current {
  margin: 0 0 var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-callout);

  b {
    color: var(--text);
    font-weight: var(--weight-medium);
  }
}

.scale {
  display: flex;
  gap: var(--space-2);
  justify-content: space-between;
}

.key {
  @include display-type;

  flex: 1;
  min-height: var(--rating-key);
  border: var(--hairline) solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text);
  font-size: var(--text-title);
  font-variant-numeric: tabular-nums;
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
  font-size: var(--text-footnote);
}

@media (prefers-reduced-motion: reduce) {
  .key {
    transition: none;
  }
}
</style>
