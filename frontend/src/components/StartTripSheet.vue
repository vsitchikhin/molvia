<template>
  <BottomSheet
    ref="sheet"
    :open="open"
    :on-closed="onClosed"
    @update:open="$emit('update:open', $event)"
  >
    <template #title>{{ t('trip.start.title') }}</template>

    <ScreenState
      v-if="!actor.settings"
      kind="offline"
      tone="warn"
      inline
      :title="t('settings.offline.title')"
      :body="t('settings.context_missing')"
    />
    <AppReveal>
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
    </AppReveal>

    <AppField
      v-model="name"
      :label="t('trip.start.other')"
      :maxlength="NAME_MAX"
      autocapitalize="sentences"
      enterkeyhint="done"
      :error-text="nameBad ? t('spending.sheet.bad_text') : null"
      @update:model-value="nameBad = false"
    />

    <template #footer>
      <!-- Not now while a shop is missing, saying so (MOL-174, Ф-6), as «Где купили?» (MOL-354); a name no
           place takes is refused at the tap and heard there: `disabled` left the focus order in silence. -->
      <AppButton size="large" block :inactive="waitsFor !== null" @click="startTyped">
        {{ waitsFor === 'place' ? t('receipt.place.choose_place') : t('trip.none.action') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { drawsNothing, newPlaceSchema, pastedLine } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import AppReveal from '@/components/AppReveal.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import { useFieldRefusal } from '@/composables/useFieldRefusal'
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
  components: { AppButton, AppField, AppReveal, BottomSheet, ScreenState },
  props: {
    open: { type: Boolean, required: true },
    /**
     * Called once the sheet is away — the moment its opener may move (MOL-128): «Покупки» opens
     * the record then, since a move under an open sheet closes it and its own step back would land
     * on the screen just opened.
     */
    onClosed: { type: Function as PropType<() => void>, default: undefined },
    /**
     * The record open now, to be put away by this very start and not before it (MOL-128, review
     * Р-2): «Закончить и начать новую» finished it at once, and a «Где вы?» dismissed then left
     * no record at all. Finished — or removed, with «Вернуть», when nothing is in it: a finished
     * empty record is a row of nothing in «Записаны» for good (MOL-76, В-2).
     */
    replacing: {
      type: Object as PropType<{ tripId: string; place: string; empty: boolean } | null>,
      default: null,
    },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    /** A trip went into the queue: the sheet closes with a record to go to. */
    started: () => true,
  },
  setup(props, { emit }) {
    const { t } = useI18n()
    const queue = useTripQueueStore()
    const actor = useActorStore()
    const places = useRecentPlacesStore()

    const name = ref('')
    /** A shop named in what no place takes, refused at the tap (MOL-354), as «Где купили?» does. */
    const nameBad = ref(false)

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
        nameBad.value = false
        // What the phone remembers is shown at once; the server only refreshes it, and a failure
        // leaves what is remembered.
        void places.refresh().catch(() => undefined)
      },
      // A sheet mounted already open — the way a test raises it, and the way a screen could — has
      // no change to watch for, and would come up with an empty list.
      { immediate: props.open },
    )

    /**
     * What the button waits for (MOL-354): the settings — said by the state above the field, so the
     * button keeps the word of its action — then a shop. A name that draws something is no wait: the
     * tap takes it or refuses it, and «Выберите магазин» over a shop typed would be untrue.
     */
    const waitsFor = computed<'settings' | 'place' | null>(() =>
      !actor.settings ? 'settings' : drawsNothing(name.value) ? 'place' : null,
    )
    const sheet = ref<{ $el: Element } | null>(null)
    const refuse = useFieldRefusal()

    function startTyped(): void {
      // a shop named in what the server would not keep — a character no place takes
      nameBad.value = !newPlaceSchema.shape.name.safeParse(name.value).success
      if (nameBad.value) {
        void refuse(() => sheet.value?.$el.querySelector<HTMLElement>('[aria-invalid="true"]'))
        return
      }
      start(name.value)
    }

    function start(place: string): void {
      if (drawsNothing(place) || !actor.settings) return
      // In the queue before the start, so the server sees the one open record end first.
      const old = props.replacing
      if (old?.empty) queue.removeTrip(old.tripId, old.place)
      else if (old)
        queue.enqueue({ kind: 'finish', tripId: old.tripId, finishedOnDeviceAt: new Date() })
      queue.enqueue({
        kind: 'start',
        context: { ...actor.settings },
        // Named by the device, in lower case, and never by `crypto.randomUUID` alone: a phone on
        // the LAN over plain http has no such function, and the tap would throw (В2-10).
        tripId: newId(),
        place: { kind: 'store', name: place },
        startedAt: new Date(),
      })
      emit('started')
      emit('update:open', false)
    }

    // The store itself, not its list: an array unwrapped here would stop following the store,
    // and the places the server answers with would never reach the screen.
    return { t, name, nameBad, waitsFor, sheet, NAME_MAX, places, start, startTyped, actor }
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
  overflow-wrap: anywhere;
  cursor: pointer;

  &:focus-visible {
    @include focus-ring;
  }
}
</style>
