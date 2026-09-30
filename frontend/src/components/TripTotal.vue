<template>
  <div class="total">
    <div class="figures">
      <div class="sums">
        <p class="caption">{{ trip?.receipt ? t('trip.receipt.total') : t('trip.total') }}</p>
        <!-- Flipped, the big number is the conversion — and it keeps every sign of being one:
           «≈», the muted colour, and the exact sum beside it (handoff «Валюты», В2-5). -->
        <p class="sum" :class="{ guess: flipped }">{{ big }}</p>
        <p v-if="rest.length > 0" class="rest">{{ rest.join(' · ') }}</p>
      </div>

      <component
        :is="flippable ? 'button' : 'div'"
        class="aside"
        :type="flippable ? 'button' : undefined"
        :aria-pressed="flippable ? flipped : undefined"
        @click="flippable && flip()"
      >
        <!-- Hidden text in front of what the button shows, never an `aria-label`: a label would
           replace the number, the rate and the caveat with the name of the action, and the caveat
           is what matters most to whoever is listening (AppScreen does the same, В2-6). -->
        <span v-if="flippable" class="hidden">{{ t('trip.flip') }}</span>
        <p v-if="estimate" class="estimate">{{ estimate }}</p>
        <p v-if="rateLine" class="rate">{{ rateLine }}</p>
        <p v-if="caveat" class="caveat">{{ caveat }}</p>
      </component>
    </div>

    <!-- What the prices say beside the receipt's sum (MOL-78, В-2): every figure the server's. -->
    <ul v-if="split.length > 0" class="split">
      <li v-for="line in split" :key="line.key" :class="{ warn: line.warn }">
        <span>{{ line.label }}</span>
        <span v-if="line.amount" class="amount">{{ line.amount }}</span>
      </li>
    </ul>
    <p v-if="waiting" class="waiting">{{ waiting }}</p>
    <button v-if="receiptAction" class="receipt" type="button" @click="$emit('receipt')">
      {{ receiptAction }}
    </button>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, ref } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  formatEstimate,
  formatMoney,
  formatRate,
  formatRateBeside,
  yerevanDate,
} from '@molvia/model'
import type { Money, TripView } from '@molvia/model'
import { calendarDay } from '@/days'
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
 * **The conversion always looks like an estimate**: «≈» and the muted colour stay on it in either
 * position of the flip, and beside the big number it is smaller as well. Two equal numbers read as
 * two facts; there is one fact here and one guess, and the guess may be wrong by the whole rate.
 * Flipped, the person asked for their own money to be the big number (handoff «Валюты»), so the
 * size is theirs to change and the other two marks are not.
 *
 * **Only the trip's own currency is converted.** A purchase paid for in another is its own line
 * under the total: adding two currencies is refused by the domain and meaningless on a screen.
 *
 * **With a receipt's sum the big number is the receipt** (MOL-78, В-2): «Итого по чеку», and under
 * it what the prices say — how many purchases have one and what they came to, what the rest came
 * to, or by how much the prices miss the receipt. Those figures are the server's (`prices`, `gap`);
 * the phone only counts the rows with a price among the rows the server sent. A sum still in the
 * queue is a line of its own, never the total (MOL-82's rule).
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
    /**
     * «Сумма по чеку» still in the queue (MOL-78): the sum typed, or `receipt: null` for one taken
     * off — said in words beside the total, which stays the server's until the answer comes.
     */
    receiptWaiting: {
      type: Object as PropType<{ readonly receipt: Money | null } | null>,
      default: null,
    },
    /** Whether «+ Сумма по чеку» is offered: a record with purchases (В-1). */
    offerReceipt: { type: Boolean, default: false },
  },
  emits: {
    receipt: () => true,
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
      // The person's own — from their exchanges, or entered for this trip after a jump — is said
      // to be theirs: «мой курс» beside a number reads differently from the bank's (MOL-40).
      // After a jump, on the side the jump's note and sheet print by — the rate before it, or the
      // jumped when there is none: «23,26 ₽/֏» over «0,043 ֏/₽ вместо 4,31 ֏/₽» was one rate read
      // two ways a line apart (review Т-11, adversarial А‴).
      const jump = props.trip.rateJump
      const anchor = jump ? (jump.previous ?? jump.jumped) : null
      return t(rate.source === 'personal' ? 'trip.rate_line_mine' : 'trip.rate_line', {
        rate: anchor
          ? formatRateBeside(rate, anchor, locale.value)
          : formatRate(rate, locale.value),
        // A rate is dated by a day of Yerevan: printed as that day, never as the moment of its
        // midnight, which is the evening before west of UTC+4 (adversarial Ж″).
        date: calendarDay(yerevanDate(rate.asOf), locale.value, { day: 'numeric', month: 'short' }),
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

    const split = computed(() => {
      const trip = props.trip
      if (!trip?.receipt) return []
      const all = trip.expenses.length
      const priced = trip.expenses.filter((expense) => expense.amount !== null).length
      const lines: { key: string; label: string; amount: string | null; warn: boolean }[] = []
      if (priced > 0 && trip.prices.length > 0) {
        lines.push({
          key: 'priced',
          label: t('trip.receipt.priced', { n: priced, total: all }),
          amount: trip.prices.map((value) => money(value)).join(' · '),
          warn: false,
        })
      }
      const gap = trip.gap
      if (gap?.kind === 'unpriced') {
        lines.push({
          key: 'unpriced',
          label: t('trip.receipt.unpriced', { n: all - priced }),
          amount: money(gap.amount),
          warn: false,
        })
      } else if (gap) {
        lines.push({
          key: gap.kind,
          label: t(`trip.receipt.${gap.kind}`, { amount: money(gap.amount) }),
          amount: null,
          warn: gap.kind === 'over',
        })
      }
      return lines
    })

    const waiting = computed(() => {
      const held = props.receiptWaiting
      if (!held) return null
      return held.receipt
        ? t('trip.receipt.sending', { amount: money(held.receipt) })
        : t('trip.receipt.removing')
    })

    const receiptAction = computed(() => {
      if (props.trip?.receipt || props.receiptWaiting?.receipt) return t('trip.receipt.edit')
      return props.offerReceipt ? t('trip.receipt.add') : null
    })

    return {
      t,
      big,
      rest,
      estimate,
      rateLine,
      caveat,
      flippable,
      flipped,
      flip,
      split,
      waiting,
      receiptAction,
    }
  },
})
</script>

<style scoped lang="scss">
.total {
  padding: var(--space-3) 0;
}

.figures {
  display: flex;
  gap: var(--space-3);
  align-items: flex-end;
  justify-content: space-between;
}

.split {
  display: grid;
  gap: var(--space-1);
  margin: var(--space-2) 0 0;
  padding: 0;
  list-style: none;
  color: var(--text-muted);
  font-size: var(--text-footnote);

  li {
    display: flex;
    gap: var(--space-3);
    justify-content: space-between;
  }

  .warn {
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--warn-tint);
    color: var(--warn-ink);
  }
}

.amount {
  color: var(--text);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.waiting {
  margin: var(--space-1) 0 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.receipt {
  @include touch-target;

  margin: 0;
  padding: 0;
  border: none;
  background: none;
  color: var(--accent-ink);
  font: inherit;
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
  cursor: pointer;

  &:focus-visible {
    @include focus-ring;
  }
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

/* An estimate never looks like a fact: the big number, when it is the conversion, is muted and
   keeps its «≈» — only its size is the person's choice. */
.guess {
  color: var(--text-muted);
}

.hidden {
  @include visually-hidden;
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
