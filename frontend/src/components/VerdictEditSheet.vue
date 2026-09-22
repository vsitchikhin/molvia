<template>
  <BottomSheet v-model:open="open" :on-closed="onClosed">
    <template #title>{{ name }}</template>
    <template #meta>{{ mine ? t('advice.edit.meta') : t('advice.edit.meta_new') }}</template>

    <RatingScale v-model="score" />
    <!-- The scale has one undo — a second tap on the chosen digit — and clearing it is not a
         change the server can be asked for: a verdict without a score does not exist. Said
         here rather than left to be discovered after saving (А5). -->
    <p v-if="keepsScore" class="hint">{{ t('advice.edit.keeps_score') }}</p>

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
      <AppButton size="large" block :disabled="!ready || sending" @click="save">
        {{ mine ? t('verdict.save') : t('advice.edit.save_new') }}
      </AppButton>
      <template v-if="mine">
        <AppButton variant="danger-ghost" block :disabled="sending" @click="withdraw">
          {{ t('advice.edit.withdraw') }}
        </AppButton>
        <p class="hint">
          {{ shared ? t('advice.edit.withdraw_hint_shared') : t('advice.edit.withdraw_hint') }}
        </p>
      </template>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '@molvia/client'
import { ERROR, ISSUE, ratingSchema, tidyText } from '@molvia/model'
import type { VerdictAmendment, WireCode } from '@molvia/model'
import { api } from '@/api'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import RatingScale from '@/components/RatingScale.vue'
import type { Score } from '@/components/rating'

/** The review's own bound (`newVerdictSchema`), kept by the field so it cannot be passed. */
const REVIEW_MAX = 500

/**
 * What a refusal is worth saying in its own words. Anything else is the connection or a
 * server that broke — and those two are told apart after the failure, not before the request.
 *
 * Without this every refusal read «Не получилось сохранить. Попробуйте ещё раз», including the
 * two a repeat cannot fix: a verdict that is not this person's (А2) and a patch that changes
 * nothing (А7). `VerdictCard` has had the same rule since MOL-28 (МР-4).
 */
const SPOKEN: Partial<Record<WireCode, string>> = {
  [ERROR.NOT_FOUND]: 'advice.edit.not_mine',
  [ISSUE.PATCH_EMPTY]: 'advice.edit.nothing_changed',
}

/**
 * Rating an item from the screen where one meets it, and changing or withdrawing a rating
 * already given (MOL-32, В-1 and А2).
 *
 * Until now a mis-tapped score was beyond repair: «Оценки» only ever asks about purchases that
 * have no verdict yet, so a «1» given to a good sausage would stand until it was bought again.
 * The routes to fix it have existed since MOL-27 and had no caller at all.
 *
 * **`mine` decides which of the two this is**, and it comes from the server (`isMine`): in the
 * shared mode a row may be entirely other people's, and nothing else in it says so — a review
 * is empty there exactly as it is on one's own verdict without one. Told apart, a stranger's
 * row is rated with `PUT` and offers no «Снять оценку»; before, every save on one came back
 * 404 under the words «Попробуйте ещё раз», which a repeat could not fix (А2).
 *
 * **The score is offered pre-chosen only when the figure on the row is the person's own.** In
 * the shared mode the row carries an average of several people, and pre-choosing it would let
 * a save quietly write everyone else's average down as this person's opinion.
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
    /** Whether there is a verdict of this person's behind the row at all (`AdviceRow.isMine`). */
    mine: { type: Boolean, required: true },
    /** Whether the row's figures are everyone's: it changes what withdrawing does. */
    shared: { type: Boolean, default: false },
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
    const failure = ref<WireCode | 'offline' | 'failed' | null>(null)
    const unsupported = ref(false)

    // A score taken back is not a change the server can be asked for: a verdict without a
    // score does not exist, and the only way to have none is to withdraw it.
    const scoreChanged = computed(() => score.value !== null && score.value !== props.ownScore)
    const reviewChanged = computed(() => review.value !== (props.ownReview ?? ''))
    /** Without a verdict of one's own there is nothing to amend: a score is the whole entry. */
    const ready = computed(() =>
      props.mine ? scoreChanged.value || reviewChanged.value : score.value !== null,
    )
    const keepsScore = computed(() => props.mine && props.ownScore !== null && score.value === null)

    // Cleared as soon as anything is touched, and synchronously, so a refusal set inside
    // `save` is not wiped by the same edit that caused it (МР-6, as `VerdictCard` does).
    watch(
      [score, review],
      () => {
        unsupported.value = false
        failure.value = null
      },
      { flush: 'sync' },
    )

    const status = computed(() => {
      const code = failure.value
      if (code === null) return ''
      if (code === 'offline') return t('advice.edit.offline')
      if (code === 'failed') return t('advice.edit.failed')
      return t(SPOKEN[code] ?? 'advice.edit.failed')
    })

    async function send(run: () => Promise<unknown>): Promise<void> {
      sending.value = true
      failure.value = null
      try {
        await run()
        emit('saved')
        open.value = false
      } catch (error) {
        const code = error instanceof ApiError ? error.code : null
        // Decided after the failure: a connection that went while the answer was on its way is
        // not the server breaking. A code the domain has words for keeps its own.
        failure.value = code && code in SPOKEN ? code : navigator.onLine ? 'failed' : 'offline'
      } finally {
        sending.value = false
      }
    }

    function save(): void {
      if (!ready.value || sending.value) return
      // Tidied first, asked about after: a review of invisible marks is as empty as one of
      // spaces, and goes without a review the same way (MOL-28, С-16).
      const tidied = tidyText(review.value)
      review.value = tidied.trim() ? tidied : ''
      if (review.value && !ratingSchema.shape.review.safeParse(review.value).success) {
        unsupported.value = true
        return
      }
      const chosen = score.value
      if (!props.mine) {
        // A first verdict is not an amendment: `PATCH` has nothing to change and answers 404.
        if (chosen === null) return
        void send(() =>
          api.rateItem(props.itemId, {
            score: chosen,
            ...(review.value ? { review: review.value } : {}),
          }),
        )
        return
      }

      const patch: VerdictAmendment = {
        ...(scoreChanged.value && chosen !== null ? { score: chosen } : {}),
        // `null` is the one way to erase the text, and an emptied field means exactly that.
        ...(reviewChanged.value ? { review: review.value || null } : {}),
      }
      // Weighed **after** the text was tidied, and by the patch itself rather than by what the
      // button knew: a space typed into an empty review made it live, and then went — the
      // patch left as `{}` and came back refused, with «Попробуйте ещё раз» over it (А7).
      if (Object.keys(patch).length === 0) return
      void send(() => api.amendVerdict(props.itemId, patch))
    }

    function withdraw(): void {
      if (sending.value || !props.mine) return
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
      ready,
      keepsScore,
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
  min-height: var(--text-footnote);
  margin: 0 0 var(--space-2);
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
