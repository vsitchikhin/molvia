<template>
  <div class="total">
    <div class="sums">
      <p class="caption">{{ t('trip.total') }}</p>
      <p class="sum">{{ big }}</p>
      <p v-if="rest.length > 0" class="rest">{{ rest.join(' · ') }}</p>
    </div>

    <component
      :is="flippable ? 'button' : 'div'"
      class="aside"
      :type="flippable ? 'button' : undefined"
      :aria-label="flippable ? t('trip.flip') : undefined"
      @click="flippable && flip()"
    >
      <p v-if="estimate" class="estimate">{{ estimate }}</p>
      <p v-if="rateLine" class="rate">{{ rateLine }}</p>
      <p v-if="caveat" class="caveat">{{ caveat }}</p>
    </component>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, ref } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatEstimate, formatMoney, formatRate } from '@molvia/model'
import type { Money, TripView } from '@molvia/model'
import { purchaseDay } from '@/days'
import { read, writeEverywhere } from '@/stores/storage'

const FLIPPED = 'molvia.total-flipped'

/**
 * «ИТОГО 6 493,12 ֏ ≈ 1 347 ₽ · курс 4,82 ֏/₽ · 18 сент.» — the one permanent place in the app
 * where money is converted (handoff «Валюты»).
 *
 * **Every number here is the server's.** The phone does not add the rows up, and it does not
 * convert: `total` and `converted` come with the trip, and until a queued purchase has been
 * answered the total is honestly behind the list — hence the caveat beside it (MOL-24, В-11).
 *
 * **The conversion always looks like an estimate** — «≈», a smaller size, a muted colour — in
 * either position of the flip. Two equal numbers read as two facts; there is one fact here and
 * one guess, and the guess may be wrong by the whole rate.
 *
 * **Only the trip's own currency is converted.** A purchase paid for in another is its own line
 * under the total: adding two currencies is refused by the domain and meaningless on a screen.
 */
export default defineComponent({
  name: 'TripTotal',
  props: {
    /** The trip as the server answered it; null while it is still only on the phone. */
    trip: { type: Object as PropType<TripView | null>, default: null },
    /** How many writes of this trip the server has not taken yet. */
    pending: { type: Number, default: 0 },
    /** The trip itself has not reached the server: there is no total to show yet, and why. */
    local: { type: Boolean, default: false },
  },
  setup(props) {
    const { t, locale } = useI18n()

    // A display choice, not a fact about a trip: it holds for every trip on this device.
    const flipped = ref(read(FLIPPED) === '1')
    function flip(): void {
      flipped.value = !flipped.value
      writeEverywhere(FLIPPED, flipped.value ? '1' : '0')
    }

    const own = computed<Money | null>(() => {
      const trip = props.trip
      if (!trip) return null
      return trip.total.find((money) => money.currency === trip.currency) ?? null
    })

    const others = computed(() =>
      (props.trip?.total ?? []).filter((money) => money.currency !== props.trip?.currency),
    )

    const money = (value: Money): string => formatMoney(value, locale.value)
    const estimated = (value: Money): string =>
      t('money.approx', { amount: formatEstimate(value, locale.value) })

    const converted = computed(() => props.trip?.converted ?? null)

    /**
     * What the big number shows: the total in the trip's own currency, or — when nothing was paid
     * in it — the first of the others, so a trip paid for entirely in roubles is not a dash.
     */
    const shown = computed(() => own.value ?? props.trip?.total[0] ?? null)

    const big = computed(() => {
      const value = converted.value
      if (flipped.value && value) return estimated(value)
      return shown.value ? money(shown.value) : '—'
    })

    /**
     * Beside the big number: every other sum of the trip, and the one the flip moved down. Never
     * what is already big — a trip paid for in one foreign currency printed it twice (review 3).
     */
    const rest = computed(() => {
      const big = flipped.value && converted.value ? null : shown.value
      const lines = props.trip?.total ?? []
      return lines.filter((value) => value.currency !== big?.currency).map((value) => money(value))
    })

    const estimate = computed(() => {
      const value = converted.value
      if (!value) return null
      const sum = own.value
      return flipped.value && sum ? null : estimated(value)
    })

    const rateLine = computed(() => {
      const rate = props.trip?.rate
      if (!rate) return null
      return t('trip.rate_line', {
        rate: formatRate(rate, locale.value),
        date: purchaseDay(rate.asOf, locale.value),
      })
    })

    /**
     * Why the total is not the whole basket: purchases still on their way, and a conversion that
     * covers only the trip's own currency. Both are said plainly — a number quietly smaller than
     * what the person has picked up is the worst lie an app about money can tell.
     */
    const caveat = computed(() => {
      if (props.local) return t('trip.caveat.local')
      const lines: string[] = []
      if (props.pending > 0)
        lines.push(t('trip.caveat.pending', { n: props.pending }, props.pending))
      if (converted.value && others.value.length > 0) {
        lines.push(t('trip.caveat.partial', { currency: props.trip?.currency ?? '' }))
      }
      return lines.length > 0 ? lines.join(' · ') : null
    })

    // Nothing to swap without a conversion: a lone total is not two numbers.
    const flippable = computed(() => converted.value !== null)

    return { t, big, rest, estimate, rateLine, caveat, flippable, flip }
  },
})
</script>

<style scoped lang="scss">
.total {
  display: flex;
  gap: var(--space-3);
  align-items: flex-end;
  justify-content: space-between;
  padding: var(--space-3) 0;
}

.sums {
  min-width: 0;
}

.caption {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.sum {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-figure);
  font-weight: var(--weight-bold);
  line-height: var(--leading-tight);
  font-variant-numeric: tabular-nums;
}

.rest,
.rate,
.caveat {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-variant-numeric: tabular-nums;
}

.aside {
  @include touch-target;

  flex: none;
  flex-direction: column;
  align-items: flex-end;
  max-width: 60%;
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  text-align: right;
}

button.aside {
  cursor: pointer;

  &:focus-visible {
    @include focus-ring;
  }
}

/* «≈», a smaller size and a muted colour, whichever way the flip stands. */
.estimate {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
}
</style>
