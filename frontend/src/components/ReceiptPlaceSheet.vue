<template>
  <BottomSheet :open="open" :on-closed="onClosed" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('receipt.place.title') }}</template>
    <template #meta>{{ meta }}</template>

    <div class="form">
      <div
        v-if="choices.length > 0"
        class="choices"
        role="radiogroup"
        :aria-label="t('receipt.place.name')"
      >
        <button
          v-for="choice in choices"
          :key="choice.key"
          class="choice"
          :class="{ chosen: chosen === choice.key }"
          type="button"
          role="radio"
          :aria-checked="chosen === choice.key"
          @click="choose(choice.key)"
        >
          <span class="choice-text">
            <span class="choice-name">{{ choice.place.name }}</span>
            <span class="choice-city">{{ choice.place.city }}</span>
          </span>
          <IconCheck v-if="chosen === choice.key" class="check" aria-hidden="true" />
        </button>
      </div>

      <AppField
        v-model="name"
        :label="t('trip.start.other')"
        :maxlength="NAME_MAX"
        autocapitalize="sentences"
        enterkeyhint="done"
        @update:model-value="typed"
      />

      <AppField
        v-model="when"
        :label="t('receipt.place.when')"
        kind="date"
        min="2000-01-02"
        :max="latest"
        :display="dayShown"
        :error-text="dayBad ? t('spending.sheet.bad_day') : null"
      />
    </div>

    <template #footer>
      <AppButton size="large" block :disabled="!ready" @click="done">
        {{ action ?? t('receipt.place.done') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/mdi/check'
import { drawsNothing, newPlaceSchema, pastedLine } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import { calendarDay, localDay } from '@/days'
import { useActorStore } from '@/stores/actor'
import { useRecentPlacesStore } from '@/stores/recentPlaces'
import { placeIdOf } from '@/stores/receiptDrafts'
import type { PlaceDraft } from '@/stores/receiptDrafts'

/** As the place's own schema bounds it; the field stops before the server. */
const NAME_MAX = 200

/**
 * «Где купили?» (handoff 05, 5k): the place and the day of a receipt — the one read, the shops this
 * phone has been to, or a new one by its name in the person's city — the same choice «Где вы?» gives
 * a record typed by hand, with the day beside it. «Записать» on a receipt with no place opens it, and
 * its button records then (`action`).
 */
export default defineComponent({
  name: 'ReceiptPlaceSheet',
  components: { AppButton, AppField, BottomSheet, IconCheck },
  props: {
    open: { type: Boolean, required: true },
    /** The place the receipt holds now: read, or chosen before. */
    current: { type: Object as PropType<PlaceDraft | null>, default: null },
    /** Whether the server read it off the receipt. */
    read: { type: Boolean, default: false },
    day: { type: String, required: true },
    /** The word of the main button when it records as well: «Записать 7 покупок». */
    action: { type: String as PropType<string | null>, default: null },
    onClosed: { type: Function as PropType<() => void>, default: undefined },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    chosen: (place: PlaceDraft, day: string) =>
      typeof day === 'string' && typeof place === 'object',
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const actor = useActorStore()
    const places = useRecentPlacesStore()
    const chosen = ref<string | null>(null)
    const name = ref('')
    const when = ref(props.day)
    const latest = computed(() => localDay())

    const city = computed(() => actor.settings?.city ?? '')
    const choices = computed(() => {
      const list: { key: string; place: PlaceDraft }[] = []
      if (props.current) list.push({ key: 'current', place: props.current })
      for (const place of places.places) {
        if (props.current && placeIdOf(props.current) === place.id) continue
        list.push({ key: place.id, place: { id: place.id, name: place.name, city: city.value } })
      }
      return list
    })

    watch(
      () => props.open,
      (open) => {
        if (!open) return
        when.value = props.day
        name.value = ''
        chosen.value = props.current ? 'current' : null
        void places.refresh().catch(() => undefined)
      },
      { immediate: true },
    )

    const typedName = computed(() => {
      const value = pastedLine(name.value)
      return drawsNothing(value) ? null : value
    })
    const fresh = computed(() =>
      typedName.value && city.value
        ? newPlaceSchema.shape.name.safeParse(typedName.value).success
        : false,
    )
    // `max` of the field does not stop a day typed, and the day may come misread off the receipt:
    // a day still to come is refused here, not from the queue (review 18).
    const dayBad = computed(
      () => when.value !== '' && (when.value > latest.value || when.value < '2000-01-01'),
    )
    const ready = computed(
      () => (chosen.value !== null || fresh.value) && when.value !== '' && !dayBad.value,
    )

    return {
      t,
      NAME_MAX,
      choices,
      chosen,
      name,
      when,
      latest,
      dayBad,
      ready,
      meta: computed(() =>
        props.read && props.current
          ? t('receipt.place.read', { place: props.current.name, city: props.current.city })
          : t('receipt.place.missing'),
      ),
      dayShown: computed(() =>
        when.value ? calendarDay(when.value, locale.value, { day: 'numeric', month: 'long' }) : '',
      ),
      choose: (key: string) => {
        chosen.value = key
        name.value = ''
      },
      typed: () => {
        if (name.value.trim()) chosen.value = null
      },
      done: () => {
        const picked = choices.value.find((choice) => choice.key === chosen.value)?.place
        const place: PlaceDraft | null =
          picked ??
          (fresh.value && typedName.value ? { name: typedName.value, city: city.value } : null)
        if (!place || !when.value || dayBad.value) return
        emit('chosen', place, when.value)
        emit('update:open', false)
      },
    }
  },
})
</script>

<style scoped lang="scss">
.form {
  display: grid;
  gap: var(--space-4);
}

.choices {
  display: grid;
  gap: var(--space-2);
}

.choice {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  min-height: var(--touch-target-lg);
  padding: var(--space-2) var(--space-4);
  border: var(--hairline) solid var(--border-strong);
  border-radius: var(--radius);
  color: var(--text);
  background: var(--surface);
  text-align: left;
  font: inherit;
  cursor: pointer;

  &:focus-visible {
    @include focus-ring;
  }

  // The choice is seen by its fill and ring, the weight stays (Ф-5).
  &.chosen {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
    background: var(--accent-tint);
  }
}

.choice-text {
  display: grid;
  flex: 1;
  min-width: 0;
}

.choice-name {
  font-weight: var(--weight-medium);
  overflow-wrap: anywhere;
}

.choice-city {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.chosen .choice-city {
  color: var(--text);
}

.check {
  @include icon;

  font-size: var(--icon);
  color: var(--accent-ink);
}
</style>
