<template>
  <AppCard class="spent">
    <p class="spent-head">
      <SectionCaption as="span" inset>{{ t('spending.spent') }}</SectionCaption>
      <span v-if="change" class="change">{{ change }}</span>
    </p>
    <p class="figure">{{ whole(month.spent) }}</p>
    <!-- «≈ 0 ₽» says nothing beside «0 ֏» (handoff MOL-157 v2, «Месяц без трат»). -->
    <p v-if="month.spentIncome && month.spent.minor !== 0n" class="approx">
      ≈ {{ whole(month.spentIncome) }}
    </p>
    <p v-for="line in foreign" :key="line" class="footnote">{{ line }}</p>
    <p v-if="month.uncounted.length > 0" class="footnote">
      {{ t('spending.uncounted', { amounts: list(month.uncounted) }) }}
    </p>
    <p v-if="unsent > 0" class="footnote unsent">
      {{ t('spending.unsent', { n: unsent }, unsent) }}
    </p>

    <!-- Figures, not ways: «Доходы» and «Счета» are rows below — one way, one button
         (handoff MOL-157 01). The running month has no «На счетах»: that is «На счетах сейчас» over
         the switcher, one figure in one place (MOL-183, owner's decision В-18 «б»). -->
    <div class="tiles" :class="{ one: running }">
      <div class="tile">
        <span class="tile-label">{{ t('spending.income') }}</span>
        <span class="tile-figure">{{ whole(month.income) }}</span>
        <span v-if="month.incomeUncounted.length > 0" class="tile-note">
          {{ t('spending.income_uncounted', { amounts: list(month.incomeUncounted) }) }}
        </span>
        <!-- Where a salary went, both ways (MOL-134, Н-2): the switch of months does not
             go past the running one, and a salary of the 26th would just be missing. -->
        <span v-if="month.shiftedIn.length > 0" class="tile-note">
          {{ t('spending.income_shifted_in', { days: days(month.shiftedIn) }) }}
        </span>
        <span v-if="month.shiftedOut.length > 0" class="tile-note">
          {{ t('spending.income_shifted_out', { days: days(month.shiftedOut) }) }}
        </span>
      </div>
      <!-- «Остаток» of a closed month (MOL-134): the accounts on its last evening, each figure with
           what it misses; «—» says why from the answer, never a rate that is not the reason. -->
      <div v-if="!running" class="tile rest">
        <span class="tile-label">{{ restLabel }}</span>
        <template v-if="month.rest">
          <span class="tile-figure" :class="{ negative: month.rest.total.minor < 0n }">
            ≈ {{ signed(month.rest.total) }}
          </span>
          <span v-for="line in restNotes.total" :key="line" class="tile-note">
            {{ line }}
          </span>
          <template v-if="restNotes.spendable">
            <span class="tile-sub" :class="{ negative: month.rest.spendable.minor < 0n }">
              {{ t('spending.rest_spendable', { amount: signed(month.rest.spendable) }) }}
            </span>
            <span v-for="line in restNotes.spendable" :key="line" class="tile-note">
              {{ line }}
            </span>
          </template>
        </template>
        <template v-else>
          <span class="tile-figure">—</span>
          <span v-if="month.accountsFrom" class="tile-note">
            {{ t('spending.rest_from', { day: shortDay(month.accountsFrom) }) }}
          </span>
          <RouterLink v-else class="tile-link" :to="{ name: 'money-accounts' }">
            {{ t(month.accountsRemoved ? 'spending.rest_removed' : 'spending.rest_add') }}
          </RouterLink>
        </template>
      </div>
    </div>

    <p class="footnote rate">{{ rateLine }}</p>
  </AppCard>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  MONTH_STARTED_DAYS,
  formatEstimate,
  lastDayOf,
  percentChange,
  previousMonth,
} from '@molvia/model'
import type { Money, MoneyMonthView } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import { signedAmount } from '@/components/accounts'
import { signedPercent } from '@/components/charts'
import { bankWords, rateWords } from '@/components/spending'
import { calendarDay } from '@/days'

/**
 * The card of the month on «Деньги» (MOL-82, MOL-159, MOL-183): what was spent and how it compares,
 * what came in and — of a closed month — what was on the accounts on its last evening, and the rate
 * it is counted by. Every figure is the server's; the two of the comparison are the model's.
 *
 * **The running month is compared to the same day of the one before** (MOL-183, С-12, Ф-32):
 * «−10 % к тому же дню августа» — by the day the server names, the rule «Графики» compare by
 * (`comparedDay`); to the third day «Месяц только начался», since a percent there says more about the
 * calendar than about the money. **A closed one to the one before whole**: «+94 % к июлю».
 *
 * Its rows of figures are drawn as the kit's `figure` part stands (MOL-178): the caption's line, the
 * figure at `--leading-tight`, «≈» at the same — so the tiles come in where the part's plate stood.
 */
export default defineComponent({
  name: 'MoneyMonthCard',
  components: { AppCard, SectionCaption },
  props: {
    month: { type: Object as PropType<MoneyMonthView>, required: true },
    /** The running month, `YYYY-MM`, by the phone's day. */
    current: { type: String, required: true },
    /** «Ещё не учтено»: the month's spendings still on the phone — a row each, never a sum. */
    unsent: { type: Number, default: 0 },
  },
  setup(props) {
    const { t, locale } = useI18n()
    const running = computed(() => props.month.month === props.current)

    const whole = (value: Money) => formatEstimate(value, locale.value)
    const signed = (value: Money) => signedAmount(value, locale.value, { estimate: true })
    const list = (values: readonly Money[]) => values.map(whole).join(', ')
    const shortDay = (day: string) =>
      calendarDay(day, locale.value, { day: 'numeric', month: 'short' })
    const days = (values: readonly string[]) => values.map(shortDay).join(', ')

    /** «На счетах 31 авг.»: the tile stands only in a closed month, which names its day. */
    const restLabel = computed(() =>
      t('spending.rest_on', { date: shortDay(lastDayOf(props.month.month)) }),
    )

    // What each figure of «Остаток» misses, in the server's words (MOL-134, adversarial А, Б, З):
    // «без сбережений» is drawn only where it says something «всего» does not.
    const restNotes = computed(() => {
      const rest = props.month.rest
      if (!rest) return { total: [], spendable: null }
      const notes = (
        accounts: readonly { name: string; balance: Money }[],
        operations: number,
      ): string[] => [
        ...(accounts.length > 0
          ? [
              t('spending.rest_uncounted', {
                accounts: accounts.map((one) => `${one.name} ${signed(one.balance)}`).join(', '),
              }),
            ]
          : []),
        ...(operations > 0 ? [t('spending.rest_operations', { n: operations }, operations)] : []),
      ]
      const total = notes(rest.uncounted.total, rest.operationsUncounted.total)
      const spendable = notes(rest.uncounted.spendable, rest.operationsUncounted.spendable)
      const same = rest.spendable.minor === rest.total.minor && spendable.join() === total.join()
      return { total, spendable: same ? null : spendable }
    })

    const change = computed(() => {
      const value = props.month
      const before = previousMonth(value.month).slice(5)
      if (running.value) {
        // An answer kept from before the comparison to the same day says nothing until it is read.
        const toDay = value.previousToDay
        if (!toDay) return null
        if (toDay.day <= MONTH_STARTED_DAYS) return t('spending.month_started')
        const percent = toDay.spent ? percentChange(value.spent, toDay.spent) : null
        if (percent === null) return null
        return t('spending.vs_same_day', {
          change: signedPercent(percent, locale.value),
          month: t(`spending.month_of.${before}`),
        })
      }
      if (!value.previousSpent) return null
      const percent = percentChange(value.spent, value.previousSpent)
      if (percent === null) return null
      return t('spending.vs_previous', {
        percent: signedPercent(percent, locale.value),
        month: t(`spending.month_to.${before}`),
      })
    })

    const foreign = computed(() =>
      props.month.foreign.map(({ amount, counted }) =>
        t('spending.foreign_part', {
          amount: formatEstimate(amount, locale.value),
          counted: whole(counted),
        }),
      ),
    )

    const rateLine = computed(() => {
      const value = props.month
      if (!value.rate) return t('spending.rate_none')
      const rate = rateWords(value.rate, locale.value, t)
      if (value.rateKind === 'frozen') {
        const date = calendarDay(lastDayOf(value.month), locale.value)
        return t('spending.rate_frozen', { date, rate })
      }
      if (value.rate.source === 'personal') return t('spending.rate_live_mine', { rate })
      // A fallback is not the pair's bank, and the month does not say whose it is (MOL-110, review 1):
      // the bank is named as the one that is silent, never as the source.
      const bank = bankWords(value.rate.base, value.rate.quote, t)
      return value.rate.source === 'fallback'
        ? t('spending.rate_live_fallback', { rate, bank })
        : t('spending.rate_live_official', { rate, bank })
    })

    return {
      t,
      running,
      whole,
      signed,
      list,
      shortDay,
      days,
      restLabel,
      restNotes,
      change,
      foreign,
      rateLine,
    }
  },
})
</script>

<style scoped lang="scss">
.spent {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-4);
}

/* As tall as the caption's line, the comparison centred in it: the part's caption line, and the
   figure under it where the part's stands (MOL-178). */
.spent-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin: 0;
}

.change {
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
  line-height: var(--leading-tight);
  text-align: right;
}

.figure {
  @include display-type;

  margin: 0;
  font-size: var(--text-figure);
  font-variant-numeric: tabular-nums;
  line-height: var(--leading-tight);
}

.approx {
  margin: 0;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
  line-height: var(--leading-tight);
}

.footnote {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.unsent {
  color: var(--warn-ink);
}

.rate {
  margin-top: var(--space-2);
}

.tiles {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-2);
  margin-top: var(--space-3);

  &.one {
    grid-template-columns: minmax(0, 1fr);
  }
}

.tile {
  display: grid;
  align-content: start;
  gap: var(--space-1);
  min-height: 4rem;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  background: var(--surface-2);
}

.tile-label {
  display: flex;
  align-items: center;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.tile-figure {
  font-size: var(--text-headline);
  font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;

  &.negative {
    color: var(--bad-ink);
  }
}

.tile-note {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.tile-sub {
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;

  &.negative {
    color: var(--bad-ink);
  }
}

.tile-link {
  display: inline-flex;
  align-items: center;
  min-height: var(--touch-target);
  color: var(--accent-ink);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}
</style>
