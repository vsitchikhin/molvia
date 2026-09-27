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
import {
  ERROR,
  RATE_SCALE,
  currencySign,
  decimalFromRate,
  decimalFromScaled,
  divideRounded,
  formatRate,
  formatRateBeside,
  readingOf,
} from '@molvia/model'
import type { ErrorCode, RateChoice, RateChoiceBody, TripView } from '@molvia/model'
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
    // One side for the whole sheet — the options and the field alike (MOL-81): the side of the rate
    // before the jump, which is the sane one, or of the jumped when there is none. Taken from the
    // rate the trip counts by now, the field asked on the side of the jumped rate after a jump
    // across one — 4,30 ֏/₽ to 0,43 — and the owner's «4,30» went in as drams per rouble (review
    // Т-9, adversarial А′); each option on its own side hid that very jump.
    const anchor = computed(() => {
      const held = jump.value
      return held ? (held.previous ?? held.jumped) : null
    })
    const per = computed(() => (anchor.value ? readingOf(anchor.value).per : null))
    const sign = computed(() => (per.value ? currencySign(per.value, locale.value) : ''))
    const choice = ref<RateChoice>(jump.value?.choice ?? 'jumped')
    // The decimal the person typed, printed the way the interface writes numbers — never the
    // sheet's own formatted output parsed back (adversarial В3).
    const own = ref(shownRate(jump.value?.manual ?? null))
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
        own.value = shownRate(jump.value?.manual ?? null)
        sending.value = false
        failed.value = false
        error.value = null
      },
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
      return anchor.value
        ? formatRateBeside(rate, anchor.value, locale.value)
        : formatRate(rate, locale.value)
    }

    /**
     * A rate in the field as a person writes one: no trailing zeros of the snapshot's six digits,
     * and the separator of the interface — «4312,3», not «4312.300000» (adversarial В3).
     */
    function shownRate(rate: TripView['rate']): string {
      if (!rate) return ''
      // On the side the field asks by (MOL-81), not the rate's own. Turned over, six digits are an
      // artefact of the turning — «89,525515» for a typed «89,53» — so it shows two.
      const side = per.value ?? rate.base
      const decimal = (
        side === rate.base
          ? decimalFromRate(rate.scaled)
          : decimalFromScaled(divideRounded(100n * RATE_SCALE, rate.scaled), 2)
      )
        .replace(/0+$/, '')
        .replace(/\.$/, '')
      return locale.value === 'ru' ? decimal.replace('.', ',') : decimal
    }

    /**
     * The number and the currency it is «за 1» of, named only when that is not the snapshot's
     * base — so a server that predates the field is sent what it always understood (MOL-81).
     */
    function manualBody(rate: string): RateChoiceBody {
      // The snapshot is the jumped rate: the server turns the number to its side.
      const snapshot = jump.value?.jumped
      return snapshot && per.value && per.value !== snapshot.base
        ? { choice: 'manual', rate, per: per.value }
        : { choice: 'manual', rate }
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
            ? manualBody(own.value.replace(',', '.'))
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
