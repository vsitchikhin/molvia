<template>
  <div v-if="shown" class="notices">
    <!-- A purchase the server refused: what it was, why, and a way to correct it. For every trip,
         not only the one going on — a purchase that was never recorded does not stop mattering
         when its trip is finished (MOL-22, В-3, review 2). -->
    <ScreenState
      v-for="item in rejected"
      :key="item.key"
      class="notice"
      kind="attention"
      inline
      :title="refusalTitle(item)"
      :body="refusalReason(item)"
    >
      <template #action>
        <div class="refusal-actions">
          <AppButton v-if="correctable(item)" variant="ghost" @click="correct(item)">
            {{ t('trip.rejected.fix') }}
          </AppButton>
          <AppButton variant="ghost" @click="queue.dismiss(item)">
            {{ heldBack(item) > 0 ? t('trip.rejected.drop_trip') : t('trip.rejected.drop') }}
          </AppButton>
        </div>
      </template>
    </ScreenState>

    <!-- A trip is already open: the purchases wait rather than move there by themselves,
         because «item + place» is the key the product rests on. The choice is the person's
         (adversarial Б1, owner's decision). -->
    <ScreenState
      v-if="queue.elsewhere"
      class="notice"
      kind="attention"
      inline
      :title="t('trip.elsewhere.title', { place: queue.elsewhere.place })"
      :body="elsewhereBody(queue.elsewhere)"
    >
      <template #action>
        <AppButton variant="ghost" @click="chooseTrip">{{ t('trip.elsewhere.choose') }}</AppButton>
      </template>
    </ScreenState>

    <!-- Finished with no signal: the trip is over on the phone, and what it still holds must not
         go quiet with it — on iOS nothing is sent in the background, and an app that was closed
         here would never say a word (adversarial В1). -->
    <ScreenState
      v-if="ready && unsent > 0"
      class="notice"
      kind="attention"
      inline
      :title="t('trip.unsent.title', { n: unsent }, unsent)"
      :body="t('trip.unsent.body')"
    />

    <ScreenState
      v-if="queue.needsContext"
      class="notice"
      kind="attention"
      inline
      :title="t('settings.legacy.title')"
      :body="t('settings.legacy.body')"
    >
      <template #action>
        <AppButton @click="clarifying = true">{{ t('settings.legacy.action') }}</AppButton>
      </template>
    </ScreenState>
  </div>

  <!-- Mounted always and led by `open`: under a `v-if` a sheet would be gone before it could step
       back off its own history entry (MOL-18; review 5). -->
  <TripContextSheet v-model:open="clarifying" :on-closed="settled" />

  <BottomSheet v-model:open="choosing" :on-closed="settled">
    <template #title>{{ t('trip.elsewhere.title', { place: choice?.place ?? '' }) }}</template>
    <p class="confirm">{{ choice ? elsewhereBody(choice) : '' }}</p>
    <template #footer>
      <AppButton size="large" block @click="joinTrip">{{ t('trip.elsewhere.join') }}</AppButton>
      <AppButton variant="ghost" block @click="finishOtherTrip">{{
        t('trip.elsewhere.finish')
      }}</AppButton>
    </template>
  </BottomSheet>

  <!-- Mounted on a tap and put away from `onClosed`: one opening, one correction. -->
  <ItemDetailsSheet
    v-if="opened"
    :key="opened.key"
    :entry="opened.entry"
    :expense="null"
    :trip-id="opened.tripId"
    :retry="opened.retry"
    :close-steps="1"
    :on-closed="putAway"
    @added="corrected"
  />
</template>

<script lang="ts">
import { computed, defineComponent, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ERROR, isSamePlaceName } from '@molvia/model'
import type { CatalogueEntry } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import ItemDetailsSheet from '@/components/ItemDetailsSheet.vue'
import ScreenState from '@/components/ScreenState.vue'
import TripContextSheet from '@/components/TripContextSheet.vue'
import { useCurrentTrip } from '@/composables/useCurrentTrip'
import type { RetryPurchase } from '@/composables/useItemDetails'
import { useTripQueueStore } from '@/stores/tripQueue'
import type { RejectedWrite, TripElsewhere } from '@/stores/tripQueue'

/** A refused purchase being corrected: the sheet opens on it as the queue still holds it. */
interface Opened {
  readonly key: string
  readonly entry: CatalogueEntry
  readonly tripId: string
  readonly retry: RetryPurchase
  readonly refusal: RejectedWrite
}

/**
 * What the queue on the phone has to say whether or not a record is open (MOL-128): purchases the
 * server refused, a trip already open elsewhere, purchases not sent for a trip that is over, a
 * city to name. It used to be said by «Поход» in every phase, the home screen without a trip
 * included; once the record became a nested screen, «Покупки» without one would have said none of
 * it. So it is one component, on both.
 */
export default defineComponent({
  name: 'TripNotices',
  components: {
    AppButton,
    BottomSheet,
    ItemDetailsSheet,
    ScreenState,
    TripContextSheet,
  },
  props: {
    /**
     * The record going on is known — asked or remembered. Before that its own waiting purchases
     * would be counted «не отправлено» (review Р-18; the record screen held this under
     * `phase !== 'loading'` before MOL-128).
     */
    ready: { type: Boolean, default: true },
  },
  emits: {
    /** A sheet of its own is away: the screen under it may move now (Р-7). */
    settled: () => true,
  },
  setup(_props, { emit }) {
    const { t } = useI18n()
    const queue = useTripQueueStore()
    const { trip, tripId } = useCurrentTrip()
    const choosing = ref(false)
    const choice = ref<TripElsewhere | null>(null)
    const clarifying = ref(false)

    /**
     * Moving purchases into a trip of another shop is said in words before it is offered (Р-2):
     * «item + place» is the key the product rests on, and a price of «Ереван Сити» written down
     * against «SAS» is later indistinguishable from a real one. For the same shop the sentence
     * would be untrue, so it is a second key rather than a longer one (З-4).
     *
     * «The same shop» is the database's own answer, not equal strings: a trailing space made the
     * screen promise damage that the server's own index rules out (В3).
     */
    const elsewhereBody = (asked: TripElsewhere): string =>
      isSamePlaceName(asked.place, asked.mine)
        ? t('trip.elsewhere.body', { mine: asked.mine })
        : t('trip.elsewhere.body_other', { mine: asked.mine, place: asked.place })
    function chooseTrip(): void {
      choice.value = queue.elsewhere
      choosing.value = choice.value !== null
    }
    function joinTrip(): void {
      if (choice.value) queue.joinElsewhere(choice.value)
      choosing.value = false
    }
    function finishOtherTrip(): void {
      if (choice.value) queue.finishElsewhere(choice.value)
      choosing.value = false
    }

    const rejected = computed(() => queue.rejected)

    /**
     * Purchases waiting for a trip that is not the one going on — after «Закончить», and after the
     * next trip has been started (Т-11). Those of the trip going on are lines of it, with their
     * own mark; these have nowhere else to be said. A trip the server refused — its start, or its
     * «Вернуть» — holds purchases that are going nowhere, and the notice about that trip counts
     * them (раунд 5, З1; MOL-76, round 2 Б1).
     */
    const unsent = computed(
      () =>
        queue.pending.filter(
          (write) =>
            write.kind === 'add' && write.tripId !== tripId.value && !queue.orphaned(write.tripId),
        ).length,
    )

    const shown = computed(
      () =>
        rejected.value.length > 0 ||
        queue.elsewhere !== null ||
        unsent.value > 0 ||
        queue.needsContext,
    )

    /**
     * What to call the refused write. A purchase carries its own card; an amendment or a removal
     * is named by the row it is about — and only while that row is on screen. A refusal from a
     * trip that is over stays nameless (В2-9): the row is not there to ask, and inventing a name
     * is worse than «одна запись».
     */
    function nameOf(item: RejectedWrite): string | null {
      const write = item.write
      if (write.kind === 'add') return write.entry?.name ?? null
      if (!('expenseId' in write)) return null
      const expense = trip.value?.expenses.find((row) => row.id === write.expenseId)
      return expense?.item.name ?? null
    }

    const refusalTitle = (item: RejectedWrite): string => {
      if (item.write.kind === 'restore') {
        return t('trip.remove.not_restored', { name: item.write.name })
      }
      const name = nameOf(item)
      return name ? t('trip.rejected.named', { name }) : t('trip.rejected.title')
    }

    /**
     * Purchases that will never be written because this trip was not (раунд 5, З1) — or did not
     * come back, those made after «Вернуть» among them (MOL-76, adversarial А2).
     */
    const heldBack = (item: RejectedWrite): number =>
      item.write.kind === 'start' || item.write.kind === 'restore'
        ? queue.heldBack(item.write.tripId)
        : 0

    /**
     * Why it was refused, in the person's words where the dictionary has them. A code from the
     * `issue.*` half is a fault of the app rather than of what was typed: it is named plainly and
     * carried as the code itself, which is what a report needs.
     */
    const refusalReason = (item: RejectedWrite): string => {
      const key = item.code.startsWith('error.') ? item.code : null
      const why =
        item.write.kind === 'restore'
          ? item.code === ERROR.TRIP_OPEN
            ? t('trip.remove.not_restored_open')
            : t('trip.remove.not_restored_gone')
          : key
            ? t(key)
            : t('trip.rejected.unknown', { code: item.code })
      // A refused trip holds its purchases, and nothing else on screen says so: «N ещё не
      // отправлено» promises they will go, and they will not (раунд 5, З1).
      const waiting = heldBack(item)
      return waiting > 0 ? `${why} · ${t('trip.rejected.orphaned', { n: waiting }, waiting)}` : why
    }

    /** Only a purchase can be corrected, and only one whose card the phone can still read. */
    const correctable = (item: RejectedWrite): boolean =>
      item.write.kind === 'add' && item.write.entry !== null

    const opened = ref<Opened | null>(null)
    let openings = 0

    function correct(item: RejectedWrite): void {
      const write = item.write
      if (write.kind !== 'add' || !write.entry) return
      openings += 1
      opened.value = {
        key: `fix-${write.body.id}-${String(openings)}`,
        entry: write.entry,
        tripId: write.tripId,
        // The purchase keeps its own identifier: the server never took it, so it cannot meet
        // a second copy of itself.
        retry: {
          id: write.body.id,
          quantity: write.body.quantity ?? null,
          amount: write.body.amount ?? null,
          query: write.body.query ?? null,
          missedQuery: write.body.missedQuery ?? null,
        },
        refusal: item,
      }
    }

    /** The corrected purchase is queued first, and only then the refusal is forgotten. */
    function corrected(): void {
      const refusal = opened.value?.refusal
      if (refusal) queue.dismiss(refusal)
    }

    return {
      t,
      queue,
      shown,
      rejected,
      unsent,
      choosing,
      choice,
      clarifying,
      elsewhereBody,
      chooseTrip,
      joinTrip,
      finishOtherTrip,
      refusalTitle,
      refusalReason,
      heldBack,
      correctable,
      correct,
      corrected,
      opened,
      putAway: () => {
        opened.value = null
        emit('settled')
      },
      settled: () => {
        emit('settled')
      },
    }
  },
})
</script>

<style scoped lang="scss">
.notice {
  margin-bottom: var(--space-3);
}

.refusal-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: center;
}

.confirm {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}
</style>
