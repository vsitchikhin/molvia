<template>
  <BottomSheet v-model:open="open" :on-closed="onClosed">
    <template #title>{{ name }}</template>
    <template #meta>{{ t('advice.edit.meta') }}</template>

    <RatingScale v-model="score" />

    <AppField
      v-model="review"
      class="review"
      kind="multiline"
      rows="3"
      :maxlength="REVIEW_MAX"
      :label="t('verdict.review_label')"
      :placeholder="t('verdict.review_placeholder')"
      :error-text="unsupported ? t('verdict.review_unsupported') : null"
    />

    <template #footer>
      <!-- There before its words, with only the text changing: a live region born together with
           what it says is often not read at all (MOL-19). -->
      <p class="line" :class="{ failed: Boolean(failure) }" role="status">{{ status }}</p>
      <AppButton size="large" block :disabled="!changed || sending" @click="save">
        {{ t('verdict.save') }}
      </AppButton>
      <AppButton variant="danger-ghost" block :disabled="sending" @click="withdraw">
        {{ t('advice.edit.withdraw') }}
      </AppButton>
      <p class="hint">{{ t('advice.edit.withdraw_hint') }}</p>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent, ref } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { ratingSchema, tidyText } from '@molvia/model'
import type { VerdictAmendment } from '@molvia/model'
import { api } from '@/api'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import RatingScale from '@/components/RatingScale.vue'
import type { Score } from '@/components/rating'

/** The review's own bound (`newVerdictSchema`), kept by the field so it cannot be passed. */
const REVIEW_MAX = 500

/**
 * Changing or withdrawing one's own verdict, from the screen where one meets it (MOL-32, В-1).
 *
 * Until now a mis-tapped score was beyond repair: «Оценки» only ever asks about purchases that
 * have no verdict yet, so a «1» given to a good sausage would stand until it was bought again.
 * The routes to fix it have existed since MOL-27 and had no caller at all.
 *
 * **The score is offered pre-chosen only when the figure on the row is the person's own.** In
 * the shared mode the row carries an average of several people, and pre-choosing it would let a
 * save quietly write everyone else's average down as this person's opinion. With nothing
 * chosen, «Сохранить» sends only what was actually touched — a review, a score, or both.
 *
 * **Withdrawing asks for no confirmation, and says instead what it does.** Rating again brings
 * the same row back with its original `rated_at` (MOL-27), so nothing here is irreversible —
 * and a dialog over a sheet on a phone is a second modal to dismiss with one thumb.
 *
 * The sheet talks to the API directly rather than through a queue: this is not the shelf. A
 * purchase is written where the connection drops (MOL-24), an opinion is amended sitting still,
 * and a queue for it would need a card of a purchase that this screen does not have.
 */
export default defineComponent({
  name: 'VerdictEditSheet',
  components: { AppButton, AppField, BottomSheet, RatingScale },
  props: {
    itemId: { type: String, required: true },
    name: { type: String, required: true },
    /** The person's own score, when the row carries it; null in the shared mode. */
    ownScore: { type: Number as PropType<Score | null>, default: null },
    /** The review is always the asker's own, whatever the mode (MOL-31, Р-19). */
    ownReview: { type: String as PropType<string | null>, default: null },
    /** The screen puts the sheet away from here, and asks the server again on `saved`. */
    onClosed: { type: Function as PropType<() => void>, default: undefined },
  },
  emits: {
    saved: () => true,
  },
  setup(props, { emit }) {
    const { t } = useI18n()
    const open = ref(true)

    const score = ref<Score | null>(props.ownScore)
    const review = ref(props.ownReview ?? '')
    const sending = ref(false)
    const failure = ref<'offline' | 'failed' | null>(null)
    const unsupported = ref(false)

    // A score taken back is not a change the server can be asked for: a verdict without a
    // score does not exist, and the only way to have none is to withdraw it. Counted as a
    // change, «Сохранить» stayed enabled and sent an empty patch, which comes back as a
    // refusal the person cannot act on.
    const scoreChanged = computed(() => score.value !== null && score.value !== props.ownScore)
    const reviewChanged = computed(() => review.value !== (props.ownReview ?? ''))
    const changed = computed(() => scoreChanged.value || reviewChanged.value)

    const status = computed(() => {
      if (failure.value === 'offline') return t('advice.edit.offline')
      if (failure.value === 'failed') return t('advice.edit.failed')
      return ''
    })

    async function send(run: () => Promise<unknown>): Promise<void> {
      sending.value = true
      failure.value = null
      try {
        await run()
        emit('saved')
        open.value = false
      } catch {
        // Decided after the failure: a connection that went while the answer was on its way
        // is not the server breaking.
        failure.value = navigator.onLine ? 'failed' : 'offline'
      } finally {
        sending.value = false
      }
    }

    function save(): void {
      if (!changed.value || sending.value) return
      // Tidied first, asked about after: a review of invisible marks is as empty as one of
      // spaces, and goes without a review the same way (MOL-28, С-16).
      const tidied = tidyText(review.value)
      review.value = tidied.trim() ? tidied : ''
      if (review.value && !ratingSchema.shape.review.safeParse(review.value).success) {
        unsupported.value = true
        return
      }
      unsupported.value = false

      const patch: VerdictAmendment = {
        ...(scoreChanged.value && score.value !== null ? { score: score.value } : {}),
        // `null` is the one way to erase the text, and an emptied field means exactly that.
        ...(reviewChanged.value ? { review: review.value || null } : {}),
      }
      void send(() => api.amendVerdict(props.itemId, patch))
    }

    function withdraw(): void {
      if (sending.value) return
      void send(() => api.withdrawVerdict(props.itemId))
    }

    return {
      t,
      REVIEW_MAX,
      open,
      score,
      review,
      sending,
      failure,
      unsupported,
      changed,
      status,
      save,
      withdraw,
    }
  },
})
</script>

<style scoped lang="scss">
.review {
  margin-top: var(--space-6);
}

.line {
  margin: 0 0 var(--space-2);
  min-height: var(--text-footnote);
  color: var(--text-muted);
  font-size: var(--text-footnote);
  text-align: center;
}

.failed {
  color: var(--bad-ink);
}

.hint {
  margin: var(--space-2) 0 0;
  color: var(--text-muted);
  font-size: var(--text-caption);
  text-align: center;
}
</style>
