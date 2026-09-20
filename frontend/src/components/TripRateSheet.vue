<template>
  <BottomSheet :open="open" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('trip.rate.sheet_title') }}</template>
    <template #meta>{{ t('trip.rate.sheet_meta') }}</template>

    <div class="choices" role="radiogroup" :aria-label="t('trip.rate.sheet_title')">
      <button
        v-for="option in options"
        :key="option.value"
        class="choice"
        :class="{ on: choice === option.value }"
        type="button"
        role="radio"
        :aria-checked="choice === option.value"
        @click="choice = option.value"
      >
        <span class="label">{{ option.label }}</span>
        <span class="value">{{
          option.value === 'manual' ? t('trip.rate.own') : option.rate
        }}</span>
      </button>
    </div>

    <AppField
      v-if="choice === 'manual'"
      v-model="own"
      :label="t('money.rate_label', { currency: sign })"
      kind="decimal"
      :error="error"
    />

    <template #footer>
      <p v-if="failed" class="failed" role="alert">{{ t('trip.rate.failed') }}</p>
      <AppButton size="large" block :disabled="sending" @click="submit">
        {{ t('trip.rate.save') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '@molvia/client'
import { ERROR, currencySign, decimalFromRate, formatRate } from '@molvia/model'
import type { ErrorCode, RateChoice, TripView } from '@molvia/model'
import { api } from '@/api'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import { useTripStore } from '@/stores/trip'

/**
 * «По какому курсу считать» after a jump (MOL-39, Р-19, Р-21): the new one, the one before it, or
 * the person's own for this trip. The snapshot itself is never rewritten — only the choice moves,
 * so nothing about last month changes with today's decision.
 *
 * Not through the trip queue: this is not a purchase but a number the person is looking at right
 * now, and an answer they are waiting for. A rate that is not a rate comes back as
 * `error.invalid_rate` and stays in the field, with the sheet open.
 */
export default defineComponent({
  name: 'TripRateSheet',
  components: { AppButton, AppField, BottomSheet },
  props: {
    open: { type: Boolean, required: true },
    trip: { type: Object as PropType<TripView>, required: true },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const trips = useTripStore()

    const jump = computed(() => props.trip.rateJump)
    const choice = ref<RateChoice>(jump.value?.choice ?? 'jumped')
    const own = ref(
      jump.value?.manual ? (formatRate(jump.value.manual, locale.value).split(' ')[0] ?? '') : '',
    )
    const sending = ref(false)
    const failed = ref(false)
    const error = ref<ErrorCode | null>(null)

    // Mounted with the screen now, so the form is made afresh every time it comes up — otherwise
    // it would still hold the choice of the last opening, and the error under the field with it.
    watch(
      () => props.open,
      (open) => {
        if (!open) return
        choice.value = jump.value?.choice ?? 'jumped'
        own.value = jump.value?.manual ? decimalFromRate(jump.value.manual.scaled) : ''
        sending.value = false
        failed.value = false
        error.value = null
      },
    )

    // The pair is the snapshot's; without a snapshot there is no jump and no sheet to show.
    const sign = computed(() =>
      props.trip.rate ? currencySign(props.trip.rate.base, locale.value) : '',
    )

    const options = computed(() => {
      const held = jump.value
      if (!held) return []
      const all = [
        { value: 'jumped' as const, label: t('trip.rate.new'), rate: rateOf(held.jumped) },
        held.previous
          ? { value: 'previous' as const, label: t('trip.rate.old'), rate: rateOf(held.previous) }
          : null,
        { value: 'manual' as const, label: t('trip.rate.mine'), rate: '' },
      ]
      return all.filter((option) => option !== null)
    })

    function rateOf(rate: NonNullable<TripView['rate']>): string {
      return formatRate(rate, locale.value)
    }

    async function submit(): Promise<void> {
      if (sending.value) return
      sending.value = true
      error.value = null
      failed.value = false
      try {
        const trip = await api.chooseTripRate(
          props.trip.id,
          choice.value === 'manual'
            ? { choice: 'manual', rate: own.value.replace(',', '.') }
            : { choice: choice.value },
        )
        trips.apply(trip)
        emit('update:open', false)
      } catch (caught) {
        // The one refusal a person can answer is «that is not a rate»: it stays under the field,
        // where they can fix it. Anything else is the app's or the network's, and says so once.
        if (caught instanceof ApiError && caught.code === ERROR.INVALID_RATE) {
          error.value = ERROR.INVALID_RATE
        } else {
          failed.value = true
        }
      } finally {
        sending.value = false
      }
    }

    return { t, choice, own, options, sign, error, failed, sending, submit }
  },
})
</script>

<style scoped lang="scss">
.choices {
  display: grid;
  gap: var(--space-2);
}

.choice {
  @include touch-target;

  justify-content: space-between;
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: var(--hairline) solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:focus-visible {
    @include focus-ring;
  }
}

.on {
  border-color: var(--accent);
  background: var(--accent-tint);
  color: var(--accent-ink);
}

.label {
  font-weight: var(--weight-medium);
}

.value {
  font-variant-numeric: tabular-nums;
}

.failed {
  margin: 0 0 var(--space-2);
  color: var(--bad-ink);
  font-size: var(--text-footnote);
}
</style>
