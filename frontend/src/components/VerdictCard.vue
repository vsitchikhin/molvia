<template>
  <AppCard as="section" class="verdict" :aria-labelledby="titleId">
    <p class="context">{{ t('verdict.context', { when: day, place: card.placeName }) }}</p>
    <h2 :id="titleId" ref="title" class="question" tabindex="-1">
      {{ card.name }}<br />{{ t('verdict.question_tail') }}
    </h2>

    <div class="scale" role="group" :aria-label="t('verdict.scale_group')">
      <button
        v-for="value in SCORES"
        :key="value"
        class="key"
        type="button"
        :aria-pressed="score === value ? 'true' : 'false'"
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

    <AppField
      v-model="review"
      class="review"
      kind="multiline"
      rows="3"
      :maxlength="REVIEW_MAX"
      :label="t('verdict.review_label')"
      :placeholder="t('verdict.review_placeholder')"
      :error="error"
      :error-text="unsupported ? t('verdict.review_unsupported') : null"
    />

    <AppButton class="save" :class="{ idle: score === null }" block @click="save">
      {{ score === null ? t('verdict.save_disabled') : t('verdict.save') }}
    </AppButton>
    <AppButton class="skip" variant="ghost" block @click="$emit('skip')">
      {{ t('verdict.skip') }}
    </AppButton>
  </AppCard>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, ref, useId, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { ERROR, ratingSchema, tidyText } from '@molvia/model'
import type { ErrorCode, PendingVerdict, WireCode } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppField from '@/components/AppField.vue'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { purchaseDay } from '@/days'
import type { Score, VerdictDraft } from '@/stores/verdictDrafts'

const SCORES = [1, 2, 3, 4, 5] as const satisfies readonly Score[]

/** The review's own bound (`newVerdictSchema`), kept by the field so it cannot be passed. */
const REVIEW_MAX = 500

const DOMAIN_CODES: readonly string[] = Object.values(ERROR)

/**
 * A refusal the domain has words for is shown by its code. An `issue.*` is a message to a
 * developer (MOL-18); for the review it means only that some character in it cannot be kept,
 * and the card says that in its own words (owner's decision, G2).
 */
function domainCode(code: WireCode | null | undefined): ErrorCode | null {
  return code && DOMAIN_CODES.includes(code) ? (code as ErrorCode) : null
}

/**
 * One question of «Оценки»: this item, bought there and then — how was it? (MOL-28, Р-4).
 *
 * Digits, not stars: five stars are hard to hit with a thumb and read as decoration, and here
 * the score is the entry into a verdict. A second tap on the chosen digit takes it back.
 *
 * «Сохранить» is not `disabled` without a score — it has to be reachable and heard — but it
 * does nothing then except say what is missing. The review is checked by the same schema the
 * server uses, for the person's sake only: the server decides. A card is keyed by its item, so
 * everything typed here is the card's own and goes with it.
 */
export default defineComponent({
  name: 'VerdictCard',
  components: { AppButton, AppCard, AppField },
  props: {
    card: { type: Object as PropType<PendingVerdict>, required: true },
    /** What the phone kept for this item: words typed before, or a refusal to show. */
    draft: { type: Object as PropType<VerdictDraft | undefined>, default: undefined },
    /** Take the focus on arrival — after the previous card was saved or put off. */
    focusOnMount: { type: Boolean, default: false },
  },
  emits: {
    save: (score: Score, review: string) =>
      (SCORES as readonly number[]).includes(score) && typeof review === 'string',
    skip: () => true,
    change: (score: Score | null, review: string) =>
      (score === null || (SCORES as readonly number[]).includes(score)) &&
      typeof review === 'string',
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const announce = useAnnouncer()
    const titleId = useId()
    const title = ref<HTMLElement | null>(null)

    const score = ref<Score | null>(props.draft?.score ?? null)
    const review = ref(props.draft?.review ?? '')
    const error = ref<ErrorCode | null>(domainCode(props.draft?.error))
    /** The review holds a character the server will not keep: the tab and its kin are tidied. */
    // Only with a review to blame: a refusal of an empty one is not about a character in it
    // (self-review С-19), and says the generic words instead.
    const refusedCode = Boolean(props.draft?.error) && error.value === null
    const unsupported = ref(refusedCode && Boolean(props.draft?.review.trim()))
    if (refusedCode && !unsupported.value) error.value = ERROR.INTERNAL
    let saved = false

    const day = computed(() => purchaseDay(props.card.boughtAt, locale.value))

    // Synchronous, so an error set right after an edit in `save` is not cleared by it later.
    watch(
      [score, review],
      ([nextScore, nextReview]) => {
        error.value = null
        unsupported.value = false
        if (!saved) emit('change', nextScore, nextReview)
      },
      { flush: 'sync' },
    )

    function choose(value: Score): void {
      score.value = score.value === value ? null : value
    }

    function save(): void {
      if (saved) return
      if (score.value === null) {
        announce?.(t('verdict.save_disabled'))
        return
      }
      // Tidied first, asked about after: a review of invisible marks is as empty as one of
      // spaces, and goes without a review the same way (self-review С-16).
      const tidied = tidyText(review.value)
      review.value = tidied.trim() ? tidied : ''
      if (review.value && !ratingSchema.shape.review.safeParse(review.value).success) {
        unsupported.value = true
        return
      }
      // One save per card: a double tap would otherwise hand the next card the second tap.
      saved = true
      emit('save', score.value, review.value)
    }

    onMounted(() => {
      if (props.focusOnMount) title.value?.focus({ preventScroll: true })
    })

    return {
      t,
      SCORES,
      REVIEW_MAX,
      titleId,
      title,
      score,
      review,
      error,
      unsupported,
      day,
      choose,
      save,
    }
  },
})
</script>

<style scoped lang="scss">
.verdict {
  padding: var(--space-6) var(--space-4);
}

.context {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.question {
  margin: var(--space-2) 0 var(--space-6);
  font-family: var(--font-display);
  font-size: var(--text-title);
  line-height: var(--leading-snug);
  overflow-wrap: anywhere;

  &:focus {
    outline: none;
  }
}

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

.review {
  margin-top: var(--space-6);
}

.save {
  margin-top: var(--space-6);
}

/* The handoff's «nothing chosen yet»: the button is there and speaks, but does not invite. */
.save.idle {
  background: var(--surface-2);
  box-shadow: none;
  color: var(--text-muted);
}

.skip {
  color: var(--text-muted);
  font-size: var(--text-callout);
}

@media (prefers-reduced-motion: reduce) {
  .key {
    transition: none;
  }
}
</style>
