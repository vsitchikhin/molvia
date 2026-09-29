<template>
  <AppButton size="large" block @click="begin">
    <template #icon><IconPencil /></template>
    {{ t('purchases.manual') }}
  </AppButton>

  <!-- Mounted always and led by `open`: under a `v-if` a sheet would be gone before it could step
       back off its own history entry (MOL-18; review 5). -->
  <StartTripSheet
    v-model:open="starting"
    :replacing="replacing"
    :on-closed="afterStart"
    @started="started = true"
  />

  <!-- «Уже записываете «Рынок»» (handoff `03`, 3e): the rule «one open at a time» is unchanged,
       and the choice between going on and starting anew is asked, never guessed. -->
  <BottomSheet v-model:open="asking" :on-closed="afterAsk">
    <template #title>{{ t('purchases.manual_ask.title', { place: open?.place ?? '' }) }}</template>
    <p v-if="open?.meta" class="meta">{{ open.meta }}</p>
    <p class="body">{{ t('purchases.manual_ask.body') }}</p>
    <template #footer>
      <AppButton size="large" block @click="choose('continue')">
        {{ t('purchases.manual_ask.continue', { place: open?.place ?? '' }) }}
      </AppButton>
      <AppButton variant="ghost" block @click="choose('anew')">
        {{ t('purchases.manual_ask.finish') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import IconPencil from '~icons/mdi/pencil-outline'
import AppButton from '@/components/AppButton.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import StartTripSheet from '@/components/StartTripSheet.vue'
import { useCurrentTrip } from '@/composables/useCurrentTrip'
import { useTripRows } from '@/composables/useTripRows'
import { purchaseDay, timeOfDay } from '@/days'
import { afterStep } from '@/navigation'
import { useTripStore } from '@/stores/trip'

/**
 * «Записать покупки» (MOL-128, В-5): the one way into a record typed by hand, on «Покупки» and on
 * the newcomer's «Что брать». With no record open it asks «Где вы?» and opens the record once the
 * sheet is away; with one open it asks whether to go on with it or finish it and start anew.
 *
 * Every move waits for the sheet to go: a move of the router under an open sheet closes it anyway,
 * and the sheet's own step back would then land on the screen just opened (MOL-18). And every
 * move follows the tap that asked for it, so Chrome keeps the entry on «back».
 */
export default defineComponent({
  name: 'ManualEntryButton',
  components: { AppButton, BottomSheet, IconPencil, StartTripSheet },
  emits: {
    /** Whether a sheet of its own is up: the screen keeps the button mounted meanwhile (Р-15). */
    busy: (up: boolean) => typeof up === 'boolean',
  },
  setup(_props, { emit }) {
    const { t, locale } = useI18n()
    const router = useRouter()
    const trips = useTripStore()
    const { trip, local, tripId } = useCurrentTrip()
    const { rows } = useTripRows(tripId, trip, () => '')
    /** The record «Закончить и начать новую» puts away — only once the new one starts (Р-2). */
    const replacing = ref<{ tripId: string; place: string; empty: boolean } | null>(null)

    const starting = ref(false)
    const started = ref(false)
    const asking = ref(false)
    watch([starting, asking], ([start, ask]) => {
      emit('busy', start || ask)
    })
    let chosen: 'continue' | 'anew' | null = null

    /** The record going on, as the question names it; taken when asked, not while it is up. */
    const open = ref<{ place: string; meta: string | null } | null>(null)
    const current = computed(() => {
      const place = trip.value?.place.name ?? local.value?.placeName
      const since = trip.value?.startedAt ?? local.value?.startedAt
      return place
        ? {
            place,
            meta: since
              ? t('trip.manual_since', {
                  day: purchaseDay(since, locale.value),
                  time: timeOfDay(since, locale.value),
                })
              : null,
          }
        : null
    })

    function begin(): void {
      if (tripId.value === null) {
        started.value = false
        starting.value = true
        return
      }
      open.value = current.value
      chosen = null
      asking.value = true
    }

    function choose(choice: 'continue' | 'anew'): void {
      chosen = choice
      // «Закончить и начать новую» puts nothing away yet: «Где вы?» may still be dismissed, and
      // then the open record stays as it was. The start itself ends it (Р-2).
      const id = tripId.value
      // A record started on this phone and not yet sent has nothing anywhere else to hold.
      const unsent = local.value?.id === id
      replacing.value =
        choice === 'anew' && id !== null
          ? { tripId: id, place: open.value?.place ?? '', empty: unsent && isEmpty() }
          : null
      if (replacing.value && !unsent) void emptyAsked(replacing.value.tripId)
      asking.value = false
    }

    /**
     * «Empty, so remove» is decided by the server's answer, asked now (review Р-21): the phone's
     * memory of the record may be older than purchases added on another device, and «Что брать»
     * never asks for it. Until the answer comes, or with none, the record is finished — a finished
     * empty record is a row of nothing, a removed full one loses its purchases.
     */
    async function emptyAsked(id: string): Promise<void> {
      try {
        await trips.load()
      } catch {
        return
      }
      const old = replacing.value
      if (old?.tripId !== id || trips.current?.id !== id) return
      replacing.value = { ...old, empty: isEmpty() }
    }

    function isEmpty(): boolean {
      return rows.value.every((row) => row.mark === 'removing')
    }

    // Every move follows the step back of the sheet that asked for it (`afterStep`): the sheet is
    // told it is closed before that step has landed, and a move made there is dropped (Р-11).
    function afterAsk(): void {
      const choice = chosen
      chosen = null
      afterStep(() => {
        if (choice === 'continue') void router.push({ name: 'purchase-manual' })
        else if (choice === 'anew') {
          started.value = false
          starting.value = true
        }
      })
    }

    function afterStart(): void {
      const go = started.value
      started.value = false
      replacing.value = null
      if (go) afterStep(() => void router.push({ name: 'purchase-manual' }))
    }

    return {
      t,
      starting,
      started,
      asking,
      open,
      replacing,
      begin,
      choose,
      afterAsk,
      afterStart,
    }
  },
})
</script>

<style scoped lang="scss">
.meta {
  margin: 0 0 var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.body {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}
</style>
