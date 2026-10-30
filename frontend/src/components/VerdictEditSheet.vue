<template>
  <BottomSheet v-model:open="open" :on-closed="onClosed">
    <template #title>{{ name }}</template>
    <template #meta>{{ own.mine ? t('advice.edit.meta') : t('advice.edit.meta_new') }}</template>

    <!-- The score as it stands, said over the scale: the point a change is made from, in both
         modes — the row's figure may be everyone's average (Ф-25, MOL-202). -->
    <RatingScale v-model="score" :current="own.mine && !waiting ? own.score : null" />
    <!-- The scale has one undo — a second tap on the chosen digit — and clearing it is not a
         change the server can be asked for: a verdict without a score does not exist. Said
         here rather than left to be discovered after saving (А5). -->
    <AppReveal>
      <p v-if="keepsScore" class="hint">{{ t('advice.edit.keeps_score') }}</p>
    </AppReveal>

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
      <!-- Not now in the focus, saying why (Ф-6): `disabled` left the focus order and a screen
           reader passed it by, with nothing to say what was missing. -->
      <AppButton
        size="large"
        block
        :busy="sending && !withdrawing"
        :busy-label="t('verdict.sending')"
        :inactive="withdrawing || !ready"
        @click="save"
      >
        {{ saveWord }}
      </AppButton>
      <template v-if="own.mine">
        <AppButton
          variant="danger-ghost"
          block
          :busy="withdrawing"
          :busy-label="t('advice.edit.withdrawing')"
          :inactive="sending && !withdrawing"
          @click="withdraw"
        >
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
import AppReveal from '@/components/AppReveal.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import RatingScale from '@/components/RatingScale.vue'
import type { SavedVerdict, Score } from '@/components/rating'
import { currentIdentity } from '@/stores/identity'
import { landedHalf, outcomeOf, trackWrite, writeInFlight } from '@/stores/verdictWrites'
import type { WriteOutcome } from '@/stores/verdictWrites'
import { forgetOwnPrices } from '@/stores/ownPrices'
import { reportFailure } from '@/failures'

/** The two fields of the server's answer the screen opens the sheet on next — and nothing else. */
const savedOf = ({ score, review }: SavedVerdict): SavedVerdict => ({ score, review })

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
 * **The score offered pre-chosen is the person's own, as the server sends it** (`ownScore`,
 * MOL-202), in both modes, and «Ваша оценка: N» says it over the scale. In the shared mode the
 * row's figure is an average of several people: pre-chosen, a save would write it down as this
 * person's opinion, and with nothing chosen they amended a score they could not see (Ф-25).
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
  components: { AppButton, AppField, AppReveal, BottomSheet, RatingScale },
  props: {
    itemId: { type: String, required: true },
    name: { type: String, required: true },
    /** Whether there is a verdict of this person's behind the row at all (`AdviceRow.isMine`). */
    mine: { type: Boolean, required: true },
    /** Whether the row's figures are everyone's: it changes what withdrawing does. */
    shared: { type: Boolean, default: false },
    /** The person's own score (`AdviceRow.ownScore`), in either mode; null without a verdict. */
    ownScore: { type: Number as PropType<Score | null>, default: null },
    /** The review is always the asker's own, whatever the mode (MOL-31, Р-19). */
    ownReview: { type: String as PropType<string | null>, default: null },
    /**
     * A write of this item got no answer and may have landed (MOL-202, З1–З4): no score is known as
     * the person's, nor whether the verdict was withdrawn — so a score chosen goes by `PUT`, right
     * for a verdict live and withdrawn alike.
     */
    unsure: { type: Boolean, default: false },
    /** The screen puts the sheet away from here, and asks the server again on `onSaved`. */
    onClosed: { type: Function as PropType<() => void>, default: undefined },
    /**
     * What the server answered the write with — the verdict as it now stands, `null` once withdrawn;
     * the screen opens the sheet on it until its rows are asked for again (MOL-202, А1). A handler held
     * as a prop, not an event, as `BottomSheet`'s `onClosed`: the sheet may be swept away while the
     * write is on its way, and Vue drops what an unmounted component emits — the write landed, and the
     * screen neither kept it nor asked again (adversarial Д1). `undefined` is a write that got no
     * answer: it may have landed, so the screen asks again and keeps nothing (Ж1).
     */
    onSaved: {
      type: Function as PropType<
        (itemId: string, verdict: SavedVerdict | null | undefined) => void
      >,
      default: undefined,
    },
  },
  setup(props) {
    const { t } = useI18n()
    const open = ref(true)

    /**
     * The verdict the sheet amends: the row's — or, while a write of this item is still on its way,
     * nobody knows which until it ends (Е1): then what it wrote, the row's if it was refused, and none
     * known if no answer came (Ж1). A choice made meanwhile is the person's and is kept.
     */
    const own = ref<{ mine: boolean; known: boolean; score: Score | null; review: string | null }>({
      mine: props.mine,
      known: !props.unsure,
      score: props.unsure ? null : props.ownScore,
      review: props.ownReview,
    })
    const writing = `${currentIdentity() ?? ''} ${props.itemId}`
    const earlier = writeInFlight(writing)
    const waiting = ref(earlier !== undefined)
    const score = ref<Score | null>(waiting.value ? null : own.value.score)
    const review = ref(props.ownReview ?? '')
    const sending = ref(waiting.value)
    // Which of the two is at work: «Снять оценку» and «Сохранить» share `sending` (adversarial Р1-А2)
    // — and the write this sheet waits for says its own word too (Ж2).
    const withdrawing = ref(waiting.value && earlier?.withdrawal === true)
    void earlier?.outcome.then((outcome) => {
      sending.value = false
      withdrawing.value = false
      waiting.value = false
      const untouched = score.value === null && review.value === (props.ownReview ?? '')
      settle(outcome)
      if (!untouched) return
      score.value = own.value.score
      review.value = own.value.review ?? ''
    })

    /** What the sheet stands on after a write ended — its own or the one it waited for. */
    function settle(outcome: WriteOutcome): void {
      if (outcome.kind === 'written') {
        const verdict = outcome.verdict
        own.value = {
          mine: verdict !== null,
          known: true,
          score: verdict?.score ?? null,
          review: verdict?.review ?? null,
        }
      }
      // It may have landed: no score is known as the person's, nor whether it was withdrawn — so
      // whatever is chosen is sent, by `PUT` (З2).
      else if (outcome.kind === 'unknown') own.value = { ...own.value, known: false, score: null }
    }
    const failure = ref<WireCode | 'offline' | 'failed' | null>(null)
    const unsupported = ref(false)

    // A score taken back is not a change the server can be asked for: a verdict without a
    // score does not exist, and the only way to have none is to withdraw it.
    const scoreChanged = computed(() => score.value !== null && score.value !== own.value.score)
    const reviewChanged = computed(() => review.value !== (own.value.review ?? ''))
    /** Without a verdict of one's own there is nothing to amend: a score is the whole entry. */
    const ready = computed(() => {
      if (own.value.mine && own.value.known) return scoreChanged.value || reviewChanged.value
      // A verdict whose last write got no answer: a score, or the review alone once touched (И2).
      return score.value !== null || (own.value.mine && reviewChanged.value)
    })
    const keepsScore = computed(
      () => own.value.mine && own.value.score !== null && score.value === null,
    )
    // The button's own word says why it is not now: one's own score untouched, or none chosen —
    // and a scale with nothing on it is the second, whether or not there is a verdict behind it: a
    // list the phone kept from before `ownScore` knows it is one's own but not what (А2).
    const saveWord = computed(() => {
      if (ready.value) return t(own.value.mine ? 'verdict.save' : 'advice.edit.save_new')
      return t(
        own.value.mine && own.value.score !== null
          ? 'advice.edit.nothing_changed'
          : 'verdict.save_disabled',
      )
    })

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

    async function send(run: () => Promise<SavedVerdict | null>, taking = false): Promise<void> {
      sending.value = true
      withdrawing.value = taking
      failure.value = null
      // «Тут дешевле» remembered before this verdict no longer says what the item is (MOL-92).
      forgetOwnPrices(currentIdentity(), [props.itemId])
      try {
        const write = run()
        trackWrite(writing, write, taking)
        const verdict = await write
        props.onSaved?.(props.itemId, verdict)
        open.value = false
      } catch (error) {
        reportFailure(error, 'screen')
        const outcome = outcomeOf(error)
        settle(outcome)
        // No answer: the write may have landed, and the list is asked again — never kept as written.
        if (outcome.kind === 'unknown') props.onSaved?.(props.itemId, undefined)
        const code = error instanceof ApiError ? error.code : null
        // Decided after the failure: a connection that went while the answer was on its way is
        // not the server breaking. A code the domain has words for keeps its own.
        failure.value = code && code in SPOKEN ? code : navigator.onLine ? 'failed' : 'offline'
      } finally {
        sending.value = false
        withdrawing.value = false
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
      if (!own.value.known) {
        unsure(chosen)
        return
      }
      if (!own.value.mine) {
        // A first verdict is not an amendment: `PATCH` has nothing to change and answers 404.
        if (chosen === null) return
        void send(() =>
          api
            .rateItem(props.itemId, {
              score: chosen,
              ...(review.value ? { review: review.value } : {}),
            })
            .then(({ verdict }) => savedOf(verdict)),
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
      void send(() => api.amendVerdict(props.itemId, patch).then(savedOf))
    }

    /**
     * A verdict whose last write got no answer (З2, И1–И3): it may have been withdrawn, so a score goes
     * by `PUT`, right either way — without the review, which the field shows as the row had it before
     * that write, and `PUT` keeps the server's own. A review the person touched goes after it by
     * `PATCH`, the one way to erase it, and only where the answer of `PUT` holds another; touched
     * alone, it goes alone.
     */
    function unsure(chosen: Score | null): void {
      const wanted = review.value || null
      const touched = reviewChanged.value
      if (chosen === null) {
        if (touched)
          void send(() => api.amendVerdict(props.itemId, { review: wanted }).then(savedOf))
        return
      }
      void send(async () => {
        const { verdict } = await api.rateItem(props.itemId, { score: chosen })
        const put = savedOf(verdict)
        if (!touched || put.review === wanted) return put
        // Half of it landed: the screen keeps it and the sheet stands on it, so a review refused after
        // it is said as such and sent again alone (Л1) — by a sheet that waits for it too (№7).
        settle({ kind: 'written', verdict: put })
        landedHalf(writing, put)
        props.onSaved?.(props.itemId, put)
        return savedOf(await api.amendVerdict(props.itemId, { review: wanted }))
      })
    }

    function withdraw(): void {
      if (sending.value || !own.value.mine) return
      void send(() => api.withdrawVerdict(props.itemId).then(() => null), true)
    }

    return {
      t,
      REVIEW_MAX,
      open,
      score,
      review,
      own,
      waiting,
      sending,
      withdrawing,
      failure,
      unsupported,
      ready,
      keepsScore,
      saveWord,
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
  font-size: var(--text-footnote);
  text-align: center;
}
</style>
