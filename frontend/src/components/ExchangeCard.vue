<template>
  <AppCard as="article" class="card">
    <OperationCardHead
      :day="headOf(exchange)"
      :amended="
        exchange.amendedAt ? t('exchange.amended', { date: shortDay(exchange.amendedAt) }) : null
      "
      :remove-label="t('exchange.remove', { amounts: amountsOf(exchange) })"
      :disabled="disabled"
      @remove="$emit('remove', exchange)"
    />
    <!-- The way into its amendment (MOL-42, В-3). No `aria-label`: it would replace the name whole,
         and the rate, the comparison and the note would go silent (review С-3). The verb and the
         day are said first, unseen — the day stands in the head, outside the button. -->
    <button class="body" type="button" :disabled="disabled" @click="$emit('edit', exchange)">
      <span class="verb">{{ t('exchange.edit_on', { date: dayOf(exchange) }) }}</span>
      <span class="sums">
        <span class="side">
          <span class="caption">{{ t('exchange.card_given') }}</span>
          <span class="amount">{{ moneyOf(exchange.given) }}</span>
          <span v-if="givenName" class="account">
            {{ t('accounts.card_from', { name: givenName }) }}
          </span>
        </span>
        <span class="arrow" aria-hidden="true"><IconArrow /></span>
        <span class="side received">
          <span class="caption">{{ t('exchange.card_received') }}</span>
          <span class="amount">{{ moneyOf(exchange.received) }}</span>
          <span v-if="receivedName" class="account">
            {{ t('accounts.card_to', { name: receivedName }) }}
          </span>
        </span>
      </span>
      <span class="plate">
        <span v-if="exchange.rate" class="line">
          <span class="label">{{ t('exchange.card_rate') }}</span>
          <span class="value own">{{ rateOf(exchange.rate) }}</span>
        </span>
        <!-- The market first — what one could have got at a counter that day — and the central
             bank under it, quieter: nobody changes at its rate (MOL-137, Р-5). -->
        <template v-if="market">
          <template v-for="line in marketLines" :key="line.label">
            <span class="line">
              <span class="label">{{ line.label }}</span>
              <span class="value">{{ line.rate }}</span>
            </span>
            <span class="difference">{{ line.difference }}</span>
          </template>
          <span v-if="market.pending" class="missing">{{ market.pending }}</span>
        </template>
        <span :class="{ quiet: market }" class="official">
          <template v-if="official">
            <span class="line">
              <span class="label">{{ official.label }}</span>
              <span class="value">{{ official.rate }}</span>
            </span>
            <span class="difference">{{ official.difference }}</span>
          </template>
          <!-- Under a market comparison «nothing to compare with» would be untrue (review). -->
          <span v-else class="missing">{{
            market && !exchange.officialDoubtful
              ? t('exchange.card_no_official_short')
              : noOfficialOf(exchange)
          }}</span>
        </span>
      </span>
      <span v-if="exchange.note" class="note">
        <IconNote class="note-icon" aria-hidden="true" />
        <span class="note-text">{{ exchange.note }}</span>
      </span>
    </button>
  </AppCard>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconArrow from '~icons/mdi/arrow-right'
import IconNote from '~icons/mdi/note-text-outline'
import type { ExchangeView } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'
import OperationCardHead from '@/components/OperationCardHead.vue'
import { useExchangeWords } from '@/composables/useExchangeWords'
import { dayWords, purchaseDay } from '@/days'
import { useAccountsStore } from '@/stores/accounts'

/**
 * One exchange (MOL-81, handoff 02): «when» on top, «how much» — what was given and what came —
 * large in the middle, «at what rate» on a plate below, the note last. It said all of it before in
 * five lines of small text; the parts now each have a place, and nothing wraps inside a figure.
 */
export default defineComponent({
  name: 'ExchangeCard',
  components: { AppCard, IconArrow, IconNote, OperationCardHead },
  props: {
    exchange: { type: Object as PropType<ExchangeView>, required: true },
    /** The phone's today, held by the screen and asked again when it comes back (adversarial Н). */
    today: { type: String, required: true },
    disabled: { type: Boolean, default: false },
  },
  emits: {
    edit: (exchange: ExchangeView) => typeof exchange === 'object',
    remove: (exchange: ExchangeView) => typeof exchange === 'object',
  },
  setup(props) {
    const { t, locale } = useI18n()
    const words = useExchangeWords()
    const accounts = useAccountsStore()
    // Where the money lay, by the name the account has now (MOL-81 Р-6, MOL-123).
    const nameOf = (id: string | null) =>
      id ? (accounts.accounts.find((account) => account.id === id)?.name ?? null) : null
    const market = computed(() => words.marketOf(props.exchange))
    return {
      t,
      ...words,
      givenName: computed(() => nameOf(props.exchange.givenAccountId)),
      receivedName: computed(() => nameOf(props.exchange.receivedAccountId)),
      official: computed(() => words.officialOf(props.exchange)),
      market,
      marketLines: computed(() =>
        market.value ? [market.value.best, ...(market.value.own ? [market.value.own] : [])] : [],
      ),
      shortDay: (when: Date) => purchaseDay(when, locale.value),
      // «Сегодня», «Вчера» by the phone's today (MOL-121, В-1); the button and the rate say the date.
      headOf: (exchange: ExchangeView) => dayWords(exchange.exchangedOn, locale.value, props.today),
    }
  },
})
</script>

<style scoped lang="scss">
.card {
  padding: 0;
  container-type: inline-size;
}

.body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: 100%;
  padding: 0 var(--space-4) var(--space-4);
  border: 0;
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--surface-2);
  }

  &:focus-visible {
    @include focus-ring(-2px);
  }

  &:disabled {
    cursor: default;
  }
}

.verb {
  @include visually-hidden;
}

.sums {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  gap: var(--space-2);
  align-items: start;
}

.side {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.received {
  align-items: flex-end;
  text-align: right;
}

// Two amounts and the arrow need some 290 px; narrower — a 320 px phone — the amounts no longer fit
// side by side and ran over the arrow, since a figure never wraps (review Т-2). Then they stand one
// under the other, both from the left, and the arrow, which only says «into», goes.
@container (max-width: 20rem) {
  .sums {
    grid-template-columns: minmax(0, 1fr);
  }

  .arrow {
    display: none;
  }

  .received {
    align-items: flex-start;
    text-align: left;
  }
}

.caption {
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.account {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.amount {
  @include display-type;

  font-size: var(--text-card-figure);
  font-variant-numeric: tabular-nums;
  line-height: var(--leading-snug);
}

.arrow {
  display: grid;
  place-items: center;
  width: calc(var(--space-6) + var(--space-1));
  height: calc(var(--space-6) + var(--space-1));
  margin-top: var(--space-4);
  border-radius: 50%;
  background: var(--accent-tint);
  color: var(--accent-ink);

  svg {
    @include icon;

    font-size: var(--icon-sm);
  }
}

.plate {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  background: var(--surface-2);
  font-size: var(--text-footnote);
}

.line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}

.label,
.missing {
  color: var(--text-muted);
}

.value {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.own {
  font-weight: var(--weight-bold);
}

// The official comparison under the market's: the same lines, a step quieter.
.official {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.quiet {
  padding-top: var(--space-2);
  border-top: var(--hairline) solid var(--border);
  color: var(--text-muted);

  .difference {
    padding-top: 0;
    border-top: 0;
    font-weight: var(--weight-regular);
  }
}

// Neutral, always: a good exchanger beats the bank, and the difference says nothing about why
// (MOL-40, В-3) — neither the colour of a win nor of a loss.
.difference {
  padding-top: var(--space-2);
  border-top: var(--hairline) solid var(--border);
  font-weight: var(--weight-medium);
}

.note {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.note-icon {
  @include icon;

  font-size: var(--icon-sm);
}

.note-text {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
