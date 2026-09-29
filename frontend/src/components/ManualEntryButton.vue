<template>
  <AppButton size="large" block @click="begin">
    <template #icon><IconPencil /></template>
    {{ t('purchases.manual') }}
  </AppButton>

  <!-- Mounted always and led by `open`: under a `v-if` a sheet would be gone before it could step
       back off its own history entry (MOL-18; review 5). -->
  <StartTripSheet v-model:open="starting" :on-closed="afterStart" @started="started = true" />

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
import { computed, defineComponent, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import IconPencil from '~icons/mdi/pencil-outline'
import AppButton from '@/components/AppButton.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import StartTripSheet from '@/components/StartTripSheet.vue'
import { useCurrentTrip } from '@/composables/useCurrentTrip'
import { purchaseDay, timeOfDay } from '@/days'
import { useTripQueueStore } from '@/stores/tripQueue'

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
  setup() {
    const { t, locale } = useI18n()
    const router = useRouter()
    const queue = useTripQueueStore()
    const { trip, local, tripId } = useCurrentTrip()

    const starting = ref(false)
    const started = ref(false)
    const asking = ref(false)
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
      // «Закончить и начать новую»: the finish goes into the queue behind every purchase of the
      // record, as «Закончить» on the record itself does (MOL-22, В-1).
      if (choice === 'anew' && tripId.value !== null)
        queue.enqueue({ kind: 'finish', tripId: tripId.value, finishedOnDeviceAt: new Date() })
      asking.value = false
    }

    function afterAsk(): void {
      if (chosen === 'continue') void router.push({ name: 'purchase-manual' })
      else if (chosen === 'anew') {
        started.value = false
        starting.value = true
      }
      chosen = null
    }

    function afterStart(): void {
      if (started.value) void router.push({ name: 'purchase-manual' })
      started.value = false
    }

    return {
      t,
      starting,
      started,
      asking,
      open,
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
