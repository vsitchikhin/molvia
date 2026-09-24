<template>
  <BottomSheet :open="open" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('trip.start.title') }}</template>

    <ScreenState
      v-if="!actor.settings"
      kind="offline"
      tone="warn"
      inline
      :title="t('settings.offline.title')"
      :body="t('settings.context_missing')"
    />
    <div v-if="actor.settings && places.places.length > 0" class="recent">
      <button
        v-for="place in places.places"
        :key="place.id"
        class="place"
        type="button"
        @click="start(place.name)"
      >
        {{ place.name }}
      </button>
    </div>

    <AppField
      v-model="name"
      :label="t('trip.start.other')"
      :maxlength="NAME_MAX"
      autocapitalize="sentences"
      enterkeyhint="done"
    />

    <template #footer>
      <AppButton size="large" block :disabled="!ready" @click="start(name)">
        {{ t('trip.none.action') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { drawsNothing, newPlaceSchema, pastedLine } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import { newId } from '@/ids'
import { useActorStore } from '@/stores/actor'
import ScreenState from '@/components/ScreenState.vue'
import { useRecentPlacesStore } from '@/stores/recentPlaces'
import { useTripQueueStore } from '@/stores/tripQueue'

/** As the place's own schema bounds it (`visibleLine(200)`); the field stops before the server. */
const NAME_MAX = 200

/**
 * «Где вы?» — the whole of starting a trip: the shops this phone has been to, and a field for a
 * new one. The country, the city and the currency are the person's settings; the server takes the
 * name and decides whether it is a shop it already knows (MOL-21).
 *
 * **The trip goes into the queue, not onto the network** (MOL-22, В-2): «Начать поход» is tapped
 * at the door of a shop, and a screen that waited for an answer there would leave the person with
 * nowhere to write the first purchase. The device names the trip, so every purchase queued behind
 * it knows where it belongs.
 */
export default defineComponent({
  name: 'StartTripSheet',
  components: { AppButton, AppField, BottomSheet, ScreenState },
  props: {
    open: { type: Boolean, required: true },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
  },
  setup(props, { emit }) {
    const { t } = useI18n()
    const queue = useTripQueueStore()
    const actor = useActorStore()
    const places = useRecentPlacesStore()

    const name = ref('')

    // Whatever copying brought along is made the line it was meant to be, as «Предложить товар»
    // does it: a tab or a line break inside a shop's name would make a second shop of it.
    watch(name, (typed) => {
      if (pastedLine(typed) !== typed) name.value = pastedLine(typed)
    })

    // A fresh form every time it opens, and the list asked for then — the sheet is mounted with
    // the screen, and refreshing on mount would be a request on every visit to the trip.
    watch(
      () => props.open,
      (open) => {
        if (!open) return
        name.value = ''
        // What the phone remembers is shown at once; the server only refreshes it, and a failure
        // leaves what is remembered.
        void places.refresh().catch(() => undefined)
      },
      // A sheet mounted already open — the way a test raises it, and the way a screen could — has
      // no change to watch for, and would come up with an empty list.
      { immediate: props.open },
    )

    const ready = computed(
      () =>
        !!actor.settings &&
        !drawsNothing(name.value) &&
        newPlaceSchema.shape.name.safeParse(name.value).success,
    )

    function start(place: string): void {
      if (drawsNothing(place) || !actor.settings) return
      queue.enqueue({
        kind: 'start',
        context: { ...actor.settings },
        // Named by the device, in lower case, and never by `crypto.randomUUID` alone: a phone on
        // the LAN over plain http has no such function, and the tap would throw (В2-10).
        tripId: newId(),
        place: { kind: 'store', name: place },
        startedAt: new Date(),
      })
      emit('update:open', false)
    }

    // The store itself, not its list: an array unwrapped here would stop following the store,
    // and the places the server answers with would never reach the screen.
    return { t, name, ready, NAME_MAX, places, start, actor }
  },
})
</script>

<style scoped lang="scss">
.recent {
  display: grid;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}

.place {
  @include touch-target;

  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: var(--hairline) solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: inherit;
  font: inherit;
  font-weight: var(--weight-medium);
  text-align: left;
  cursor: pointer;

  &:focus-visible {
    @include focus-ring;
  }
}
</style>
