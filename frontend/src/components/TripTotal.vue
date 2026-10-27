<template>
  <div class="total">
    <div class="figures">
      <div class="sums">
        <SectionCaption as="p" inset class="caption">{{
          trip?.receipt ? t('trip.receipt.total') : t('trip.total')
        }}</SectionCaption>
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
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Money, TripView } from '@molvia/model'
import SectionCaption from '@/components/SectionCaption.vue'
import { useTripTotal } from '@/composables/useTripTotal'

/**
 * The total of a finished record as a strip in `#docked` — what `useTripTotal` says, laid out the
 * way the trip screen had it before MOL-206. The record typed by hand draws it as a card
 * (`TripTotalCard`); this one goes when MOL-207 moves the finished record onto that card.
 */
export default defineComponent({
  name: 'TripTotal',
  components: { SectionCaption },
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
    /**
     * Whether the trip is the server's answer, which knows the receipt. A finished record read back
     * from the phone's cache does not keep it yet (the previous build reads that cache strictly), so
     * its total may be a receipt with nothing saying so: neither «+» nor «Изменить» is offered over
     * it — the sheet would open empty over a sum that is there (review 4).
     */
    receiptKnown: { type: Boolean, default: true },
  },
  emits: {
    receipt: () => true,
  },
  setup(props) {
    const { t } = useI18n()
    return { t, ...useTripTotal(props) }
  },
})
</script>

<style scoped lang="scss">
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

.sum {
  @include display-type;

  margin: 0;
  font-size: var(--text-figure);
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
