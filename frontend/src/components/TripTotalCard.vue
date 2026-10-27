<template>
  <AppCard class="total">
    <!-- The whole card flips (owner's В-17 «а»): the strip's button beside the figure became the card.
         Hidden text first, never an `aria-label`: a label would replace the figures and the caveat
         with the name of the action, and the caveat matters most to whoever is listening (В2-6).
         Spans, not paragraphs: a button holds phrasing content only. -->
    <component
      :is="flippable ? 'button' : 'div'"
      class="face"
      :class="{ flippable }"
      :type="flippable ? 'button' : undefined"
      :aria-pressed="flippable ? flipped : undefined"
      @click="flippable && flip()"
    >
      <span v-if="flippable" class="hidden">{{ t('trip.flip') }}</span>
      <SectionCaption as="span" inset class="caption">{{
        trip?.receipt ? t('trip.receipt.total') : t('trip.total')
      }}</SectionCaption>
      <!-- Flipped, the big number is the conversion and keeps every sign of being one: «≈» and the
           muted colour (handoff «Валюты», В2-5). -->
      <span class="sum" :class="{ guess: flipped }">{{ big }}</span>
      <!-- Money paid in another currency — and, flipped, the exact sum — under the figure on a line of
           its own: beside «≈» in the same currency it read «1 000 ₽ ≈ 1 347 ₽» (adversarial А4). -->
      <span v-if="rest.length > 0" class="line">{{ rest.join(' · ') }}</span>
      <!-- One line of parts, every figure the strip had, each with its words (MOL-206, Ф-23). -->
      <span v-if="parts.length > 0" class="line">
        <template v-for="(part, index) in parts" :key="part">
          <template v-if="index > 0"> · </template>
          <span class="part">{{ part }}</span>
        </template>
      </span>
      <span v-if="caveat" class="note">{{ caveat }}</span>
      <!-- What the prices say beside the receipt's sum (MOL-78, В-2): every figure the server's. -->
      <span v-if="split.length > 0" class="split">
        <span v-for="line in split" :key="line.key" class="split-line" :class="{ warn: line.warn }">
          <span>{{ line.label }}</span>
          <span v-if="line.amount" class="amount">{{ line.amount }}</span>
        </span>
      </span>
      <span v-if="waiting" class="note waiting">{{ waiting }}</span>
    </component>
  </AppCard>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Money, TripView } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import { useTripTotal } from '@/composables/useTripTotal'

/**
 * «ИТОГО 1 000 ֏ · С ценой — 1 из 2 · без цены — 1 · ≈ 236 ₽ · курс 4,24 ֏/₽ · 27 окт.» — the total
 * of the record typed by hand as a card under its list (MOL-206, handoff 7a, owner's В-17 «а»). The
 * strip went to the actions (Ф-22); what it said stays, every figure the server's (`useTripTotal`):
 * the other currencies, how much of the list has a price, «≈» in the income currency and the rate,
 * the caveats, and with a receipt's sum what the prices say beside it.
 *
 * **The card holds no other control**: «+ Сумма по чеку» stands under it on the screen — a button in
 * a button is no HTML, and the whole card is the flip.
 */
export default defineComponent({
  name: 'TripTotalCard',
  components: { AppCard, SectionCaption },
  props: {
    /** The trip as the server answered it; null while it is still only on the phone. */
    trip: { type: Object as PropType<TripView | null>, default: null },
    /** How many writes of this trip the server has not taken yet. */
    pending: { type: Number, default: 0 },
    /** The trip itself has not reached the server: there is no total to show yet, and why. */
    local: { type: Boolean, default: false },
    /** «Сумма по чеку» still in the queue (MOL-78): said beside the total, never as it. */
    receiptWaiting: {
      type: Object as PropType<{ readonly receipt: Money | null } | null>,
      default: null,
    },
    /** The rows on screen and those with no price, as «Закончить» counts them (`useTripReceipt`). */
    rows: {
      type: Object as PropType<{ readonly kept: number; readonly unpriced: number } | null>,
      default: null,
    },
  },
  setup(props) {
    const { t } = useI18n()
    const total = useTripTotal(props)

    // «≈» stays with its amount where the line wraps: «≈» at a line's end read as a sign of nothing.
    const estimate = computed(() => total.estimate.value?.replace(/^≈ /, '≈\u00a0') ?? null)
    const parts = computed(() =>
      [total.priced.value, estimate.value, total.rateLine.value].filter(
        (part): part is string => part !== null,
      ),
    )

    return {
      t,
      big: total.big,
      rest: total.rest,
      parts,
      caveat: total.caveat,
      split: total.split,
      waiting: total.waiting,
      flippable: total.flippable,
      flipped: total.flipped,
      flip: total.flip,
    }
  },
})
</script>

<style scoped lang="scss">
/* The face is the card's whole surface, its padding over the card's own, so the flip is a tap
   anywhere on it and its focus ring follows the card's corners. The 16 is `AppCard`'s padding: a card
   whose padding changes moves this with it. */
.face {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  width: calc(100% + 2 * var(--space-4));
  margin: calc(var(--space-4) * -1);
  padding: var(--space-4);
  border: none;
  border-radius: var(--radius-lg);
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
}

.flippable {
  cursor: pointer;

  &:focus-visible {
    @include focus-ring;
  }
}

.sum {
  @include display-type;

  font-size: var(--text-figure);
  font-variant-numeric: tabular-nums;
  line-height: var(--leading-tight);
}

/* An estimate never looks like a fact: the big number, when it is the conversion, is muted and
   keeps its «≈» — only its size is the person's choice. */
.guess {
  color: var(--text-muted);
}

.line,
.note,
.split {
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-variant-numeric: tabular-nums;
}

/* At the leading of the skeleton's line, so the card is as tall as its bars (MOL-178). */
.line {
  line-height: var(--leading-snug);
}

/* A part breaks inside where it must: the rate named with its bank, «rate … · National Bank of
   Serbia», is wider than the card on any phone (review 2, №1). The figures keep their no-break
   spaces, so no amount or rate splits. */
.part {
  overflow-wrap: anywhere;
}

.split {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-top: var(--space-1);
}

.split-line {
  display: flex;
  gap: var(--space-3);
  justify-content: space-between;

  &.warn {
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--warn-tint);
    color: var(--warn-ink);
  }
}

.amount {
  color: var(--text);
  font-weight: var(--weight-medium);
  white-space: nowrap;
}

.hidden {
  @include visually-hidden;
}
</style>
