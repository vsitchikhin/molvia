<template>
  <AppCard class="now">
    <RouterLink class="open" :to="{ name: 'money-accounts' }" :aria-label="label">
      <span class="words">
        <span class="caption">{{ caption }}</span>
        <span class="figure" :class="{ negative: totals.total.minor < 0n }">
          ≈ {{ signed(totals.total) }}
        </span>
        <span class="spendable" :class="{ negative: totals.spendable.minor < 0n }">
          {{ t('spending.summary.accounts_spendable', { amount: signed(totals.spendable) }) }}
        </span>
        <span v-if="totals.uncounted > 0" class="note">
          {{ t('accounts.screen.uncounted', { n: totals.uncounted }, totals.uncounted) }}
        </span>
      </span>
      <span class="count">{{ t('spending.summary.accounts_count', { n: live }, live) }}</span>
      <IconChevron class="chevron" aria-hidden="true" />
    </RouterLink>
  </AppCard>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconChevron from '~icons/mdi/chevron-right'
import type { Money, MoneyAccountsResponse } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'
import { signedAmount } from '@/components/accounts'

type IncomeTotals = NonNullable<MoneyAccountsResponse['incomeTotals']>

/**
 * «На счетах сейчас» over the month's switcher on «Деньги» (MOL-183, Ф-27, handoff MOL-157 v2 01):
 * the live accounts now, in the income currency — «всего» and «можно тратить» without the savings —
 * the one way into «Счета». «Now», not the month's: it does not move as the months are turned. The
 * figures are the server's (`incomeTotals`, В-19), the same balances «Счета» add up in the spending
 * currency; an account nothing converts today is left out and said under them, as on «Счета». Below
 * zero is «плохо» (С-17, MOL-116). Kept from before — offline, or «Счета» did not answer — it names
 * the hour they were counted at instead of «сейчас» (adversarial А3).
 *
 * **A card that is a link, as «Куда ушли», not a `NavRow`** (self-review Р2-3): the row is 52 high
 * with a label and a value, and the figure of 28 with a line under it is no row.
 */
export default defineComponent({
  name: 'MoneyAccountsNow',
  components: { AppCard, IconChevron },
  props: {
    totals: { type: Object as PropType<IncomeTotals>, required: true },
    /** How many live accounts there are: «5 счетов». */
    live: { type: Number, required: true },
    /**
     * When the figures were counted, if they are kept from before — offline, or «Счета» did not
     * answer: «На счетах на 24 сент., 14:05», never «сейчас» (adversarial А3). Null — they are now.
     */
    asOf: { type: String as PropType<string | null>, default: null },
  },
  setup(props) {
    const { t, locale } = useI18n()
    const signed = (value: Money) => signedAmount(value, locale.value, { estimate: true })
    // The name the link is read by: what it leaves out too — heard without it, the figure sounded whole.
    const label = computed(() => {
      const figures = {
        amount: signed(props.totals.total),
        spendable: signed(props.totals.spendable),
      }
      const words = props.asOf
        ? t('spending.summary.accounts_then_label', { ...figures, when: props.asOf })
        : t('spending.summary.accounts_now_label', figures)
      const missing = props.totals.uncounted
      return missing > 0
        ? `${words}. ${t('accounts.screen.uncounted', { n: missing }, missing)}`
        : words
    })
    const caption = computed(() =>
      props.asOf
        ? t('spending.summary.accounts_then', { when: props.asOf })
        : t('spending.summary.accounts_now'),
    )
    return { t, signed, label, caption }
  },
})
</script>

<style scoped lang="scss">
.now {
  padding: 0;
}

.open {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-3) var(--space-4) var(--space-4);
  border-radius: inherit;
  color: var(--text);
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;

  &:focus-visible {
    @include focus-ring(-2px);
  }
}

.words {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.caption {
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.figure {
  @include display-type;

  font-size: var(--text-figure);
  font-variant-numeric: tabular-nums;
  line-height: var(--leading-tight);
  overflow-wrap: anywhere;
}

.spendable,
.note {
  color: var(--text-muted);
  font-size: var(--text-callout);
  font-variant-numeric: tabular-nums;
}

.note {
  font-size: var(--text-footnote);
}

.negative {
  color: var(--bad-ink);
}

.count {
  flex: none;
  color: var(--text-muted);
  font-size: var(--text-callout);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.chevron {
  @include icon;

  flex: none;
  font-size: var(--icon);
  color: var(--text-muted);
}
</style>
