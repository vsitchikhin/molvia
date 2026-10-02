<template>
  <AppScreen :title="t('exchange.title')">
    <template v-if="overview && phase !== 'loading'">
      <!-- Above every branch: removing the last exchange leaves the empty state, and «Вернуть»
           must still be there (В-5). -->
      <p v-if="!online" class="strip">
        <IconCloud aria-hidden="true" />{{ t('exchange.offline.strip') }}
      </p>
      <p v-if="failed" class="strip failed" role="alert">{{ t('exchange.failed') }}</p>
      <p v-if="conflicted" class="strip" role="alert">{{ t('exchange.conflict') }}</p>
      <p v-if="amendConflicted" class="strip" role="alert">{{ t('exchange.amend_conflict') }}</p>
      <p v-if="vanished" class="strip" role="alert">{{ t('exchange.vanished') }}</p>
      <p v-if="gone" class="strip" role="alert">{{ t('exchange.restore_gone') }}</p>
      <div v-if="removed" ref="removedStrip" class="strip removed">
        <span class="removed-text">{{
          t('exchange.removed', { amounts: amountsOf(removed) })
        }}</span>
        <AppButton variant="ghost" :inactive="!online || busy" @click="restore">
          {{ t('exchange.restore') }}
        </AppButton>
      </div>
    </template>

    <!-- The shape of what is coming: the card of the rate, then cards of exchanges (handoff 02). -->
    <ScreenSkeleton v-if="phase === 'loading'" :groups="[32, 64, 48]">
      <OperationSkeleton />
    </ScreenSkeleton>

    <template v-else-if="phase !== 'idle'">
      <ScreenState
        v-if="phase === 'error'"
        kind="error"
        :title="t('exchange.load_error.title')"
        :body="t('exchange.load_error.body')"
        @retry="retry"
      />

      <!-- No button: nothing is kept on the phone, and the screen loads by itself when the
           connection is back. -->
      <ScreenState
        v-else-if="phase === 'offline'"
        kind="offline"
        tone="warn"
        :title="t('exchange.offline.title')"
        :body="t('exchange.offline.body')"
      />

      <!-- Nothing is required of anyone: the words say what an exchange buys, and that without
           one the trips simply keep counting by the central bank (MOL-40, В-3). -->
      <ScreenState
        v-else-if="phase === 'empty'"
        kind="empty"
        tone="accent"
        :icon="IconSwap"
        :title="t('exchange.empty.title')"
        :body="t('exchange.empty.body')"
      >
        <template #action>
          <AppButton block :inactive="!online" @click="compose">
            {{ t('exchange.record') }}
          </AppButton>
        </template>
      </ScreenState>

      <template v-else-if="overview">
        <!-- First under the strips (handoff MOL-157 05): what the exchanges of a year gave against
             the market, by place — moved here from «Графики» (MOL-159, MOL-152). No card when
             nothing of the twelve months was measured. -->
        <ExchangeLosses v-if="overview.losses" :losses="overview.losses" />
        <!-- Under it (handoff MOL-157 05): when the exchanges of the same twelve months were made,
             against the market of all bank clients week by week (MOL-161). -->
        <ExchangeRateChart
          v-if="overview.rateCharts"
          :chart="overview.rateCharts"
          :months="chartMonths"
          @update:months="chooseChartMonths"
        />

        <AppCard class="rate">
          <p class="caption">{{ t('exchange.my_rate') }}</p>
          <template v-if="overview.wallet">
            <p class="figure">{{ rateOf(overview.wallet.rate) }}</p>
            <p class="meta">
              {{ t(basisKey(overview.wallet.basis), { date: dayOf(overview.wallet.rate.asOf) }) }}
            </p>
            <p v-if="overview.wallet.estimated" class="meta">{{ t('exchange.estimated') }}</p>
          </template>
          <!-- Exchanges of the spending currency are there, its cost is not: the words say why, not
               «no exchanges yet» above a list of them (review С-4). -->
          <p v-else-if="overview.pair && overview.walletUnknown" class="meta">
            {{ unknownLineOf(overview.walletUnknown, overview.pair) }}
          </p>
          <!-- Priced, and still no wallet: the rate falls outside what a trip can keep — two
               slips in a chain — and «not come in yet» above the list of them would be untrue
               (adversarial В′, as С-4 said of a missing cost). -->
          <p v-else-if="overview.pair && pricedQuote" class="meta">
            {{ t('exchange.wallet_out_of_band', pairSigns(overview.pair)) }}
          </p>
          <p v-else-if="overview.pair" class="meta">
            {{ t('exchange.no_wallet', pairSigns(overview.pair)) }}
          </p>
          <p v-else class="meta">{{ t('settings.same_currencies') }}</p>
          <p v-if="overview.pair && overview.baseSince" class="meta">
            {{
              t('exchange.base_since', {
                base: pairSigns(overview.pair).base,
                date: day(overview.baseSince),
              })
            }}
          </p>

          <!-- The currencies a chain went through, each at its own price: the drams' rate above
               is only as believable as the dollars' under it (MOL-42, Р-4). -->
          <ul v-if="overview.costs.length > 0" class="costs">
            <li
              v-for="cost in overview.costs"
              :key="`${cost.rate.base}${cost.rate.quote}`"
              class="meta"
            >
              {{ costLineOf(cost) }}
            </li>
          </ul>

          <SegmentedControl
            v-if="overview.pair"
            class="preference"
            :model-value="overview.preference"
            :options="preferenceOptions"
            :legend="t('exchange.preference_legend')"
            :disabled="!online || busy"
            @update:model-value="choose"
          />
          <p v-if="overview.pair" class="meta">{{ t('exchange.preference_hint') }}</p>
        </AppCard>

        <p class="frozen"><IconCheck aria-hidden="true" />{{ t('money.rate_frozen') }}</p>

        <MarketRatesCard :rows="overview.marketToday" />

        <!-- Incomes alone can make the rate (MOL-66): then there is the card, and no list. -->
        <section v-if="overview.exchanges.length > 0" class="exchanges">
          <h2 class="caption">{{ t('exchange.list_title') }}</h2>
          <!-- A list, so a screen reader says how many and moves item by item (review Т-5). -->
          <ul class="cards">
            <AppReveal group>
              <li v-for="exchange in overview.exchanges" :key="exchange.id">
                <ExchangeCard
                  :exchange="exchange"
                  :today="today"
                  :disabled="!online || busy"
                  @edit="edit"
                  @remove="ask"
                />
              </li>
            </AppReveal>
          </ul>
        </section>
      </template>
    </template>

    <!-- «Записать обмен» floats where «Трата» does, under the thumb (handoff 02); the empty
         state keeps its own button at the bottom instead. -->
    <FloatingDock v-if="overview && phase === 'ready'">
      <AppButton
        ref="recordButton"
        size="large"
        class="add"
        :aria-label="t('exchange.record')"
        :inactive="!online || busy"
        @click="compose"
      >
        <template #icon><IconPlus /></template>
        {{ t('exchange.fab') }}
      </AppButton>
    </FloatingDock>

    <ExchangeSheet
      v-if="overview"
      v-model:open="sheetOpen"
      :overview="overview"
      :editing="editing"
      :record="record"
      :amend="amendEditing"
    />
    <ExchangeRemoveSheet
      v-model:open="removeOpen"
      :exchange="target"
      :amounts="target ? `${amountsOf(target)} · ${rateLineOf(target)}` : ''"
      :busy="busy"
      @confirm="confirmRemove"
    />
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { RATE_CHART_MONTHS, currencySign, yerevanDate } from '@molvia/model'
import type {
  Currency,
  CurrencyCost,
  ExchangeAmendBody,
  ExchangeView as Row,
  ExchangesResponse,
  RateChartMonths,
  RatePreference,
  WalletBasis,
} from '@molvia/model'
import IconCheck from '~icons/mdi/check-bold'
import IconCloud from '~icons/mdi/cloud-off-outline'
import IconPlus from '~icons/mdi/plus'
import IconSwap from '~icons/mdi/swap-horizontal'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppReveal from '@/components/AppReveal.vue'
import AppScreen from '@/components/AppScreen.vue'
import ExchangeCard from '@/components/ExchangeCard.vue'
import ExchangeLosses from '@/components/ExchangeLosses.vue'
import ExchangeRateChart from '@/components/ExchangeRateChart.vue'
import MarketRatesCard from '@/components/MarketRatesCard.vue'
import ExchangeRemoveSheet from '@/components/ExchangeRemoveSheet.vue'
import ExchangeSheet from '@/components/ExchangeSheet.vue'
import FloatingDock from '@/components/FloatingDock.vue'
import OperationSkeleton from '@/components/OperationSkeleton.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useExchangeWords } from '@/composables/useExchangeWords'
import { useExchanges } from '@/composables/useExchanges'
import type { AmendOutcome } from '@/composables/useExchanges'
import { useLocalDay } from '@/composables/useLocalDay'
import { useAccountsOnScreen, useAccountsStore } from '@/stores/accounts'

/**
 * «Обмен денег» (MOL-40), under «Деньги» since MOL-81: the person's own rate, which rate new trips take, and
 * the exchanges it is worked out from, each beside the central bank of its day. Every figure is
 * the server's; the screen only chooses words — «больше» or «меньше», never «комиссия», because a
 * good exchanger beats the bank and the difference says nothing about why.
 */
export default defineComponent({
  name: 'ExchangeView',
  components: {
    AppButton,
    AppCard,
    AppReveal,
    AppScreen,
    ExchangeCard,
    ExchangeLosses,
    ExchangeRateChart,
    ExchangeRemoveSheet,
    ExchangeSheet,
    FloatingDock,
    IconCheck,
    IconCloud,
    IconPlus,
    MarketRatesCard,
    OperationSkeleton,
    ScreenSkeleton,
    ScreenState,
    SegmentedControl,
  },
  setup() {
    const { t, locale } = useI18n()
    const route = useRoute()
    const router = useRouter()
    const exchanges = useExchanges()
    const { rateOf, day, amountsOf, rateLineOf } = useExchangeWords()
    // «Сегодня» of the cards, asked again when the app comes back into view (MOL-121, adversarial Н).
    const today = useLocalDay()
    const sheetOpen = ref(false)
    // The exchange the sheet amends, or null when it records a new one.
    const editing = ref<Row | null>(null)
    function compose(): void {
      editing.value = null
      sheetOpen.value = true
    }
    function edit(exchange: Row): void {
      editing.value = exchange
      sheetOpen.value = true
    }
    // A conflict leaves the sheet open over the version the server holds now, so a second
    // «Сохранить» goes over that one and nothing typed is lost (review Ч-2).
    async function amendEditing(id: string, body: ExchangeAmendBody): Promise<AmendOutcome> {
      const outcome = await exchanges.amend(id, body)
      // Gone in the meantime: the sheet keeps the old one, and its next save is told so.
      if (outcome === 'conflict') {
        editing.value =
          exchanges.overview.value?.exchanges.find((row) => row.id === id) ?? editing.value
      }
      return outcome
    }
    // «Удалить обмен?» first, then «Вернуть» after (В-5): the bin never removes on its own.
    const removeOpen = ref(false)
    const target = ref<Row | null>(null)
    function ask(exchange: Row): void {
      target.value = exchange
      removeOpen.value = true
    }
    // The bin that opened the sheet is gone with its row, so the dialog has nowhere to give the
    // focus back: it goes to «Вернуть», one swipe from the person, and the removal is said out
    // loud — the reason В-5 kept the offer on screen rather than on a timer (review Н-1).
    const removedStrip = ref<HTMLElement | null>(null)
    const announce = useAnnouncer()
    let unsay: (() => void) | undefined
    watch(exchanges.removed, async (exchange) => {
      unsay?.()
      unsay = exchange
        ? announce?.(t('exchange.removed', { amounts: amountsOf(exchange) }))
        : undefined
      if (!exchange) return
      await nextTick()
      removedStrip.value?.querySelector('button')?.focus()
    })
    // «Вернуть» goes with its strip once it worked: the words say the exchange is back, and the
    // focus goes to «Записать обмен», the one button that is always there (review Т-3).
    const recordButton = ref<{ $el: HTMLElement } | null>(null)
    watch(exchanges.restored, async (back) => {
      if (!back) return
      unsay?.()
      unsay = announce?.(t('exchange.restored'))
      await nextTick()
      recordButton.value?.$el.focus()
    })
    onUnmounted(() => unsay?.())

    function confirmRemove(): void {
      const exchange = target.value
      removeOpen.value = false
      if (exchange) void exchanges.remove(exchange)
    }

    const online = ref(navigator.onLine)
    const follow = (): void => {
      online.value = navigator.onLine
    }
    // The names of the accounts on the cards (MOL-123): the page as the server has it now.
    const accounts = useAccountsStore()
    useAccountsOnScreen()
    onMounted(() => void accounts.refresh())
    onMounted(() => {
      window.addEventListener('online', follow)
      window.addEventListener('offline', follow)
    })
    onUnmounted(() => {
      window.removeEventListener('online', follow)
      window.removeEventListener('offline', follow)
    })

    const preferenceOptions = [
      { value: 'personal', label: t('exchange.preference_personal') },
      { value: 'official', label: t('exchange.preference_official') },
    ]

    // The day a rate is dated by, as a calendar day of Yerevan (adversarial Ж).
    const dayOf = (when: Date): string => day(yerevanDate(when))
    const pairSigns = (pair: { base: Currency; quote: Currency }) => ({
      base: currencySign(pair.base, locale.value),
      quote: currencySign(pair.quote, locale.value),
    })

    /** Which money the rate was last taken from — an exchange or an income (MOL-66, Р-9). */
    function basisKey(basis: WalletBasis): string {
      if (basis === 'weighted') return 'exchange.basis_weighted'
      return basis === 'income' ? 'exchange.basis_income' : 'exchange.basis_last'
    }

    /** Why there is no rate: the link it was lost on — an income gave nothing, so names no «given». */
    function unknownLineOf(
      unknown: NonNullable<ExchangesResponse['walletUnknown']>,
      pair: NonNullable<ExchangesResponse['pair']>,
    ): string {
      const words = { ...pairSigns(pair), date: day(unknown.on) }
      const old = unknown.reason === 'oldReckoning'
      if (unknown.given === null) {
        return t(
          old ? 'exchange.wallet_old_reckoning_income' : 'exchange.wallet_unknown_income',
          words,
        )
      }
      return t(old ? 'exchange.wallet_old_reckoning' : 'exchange.wallet_unknown', {
        ...words,
        given: currencySign(unknown.given, locale.value),
      })
    }

    /**
     * «89,04 ₽/$ · по последнему обмену · с 31 авг.» — and whether the bank priced part of it. The
     * rate names both currencies, and one of them is always the currency of conversion; which one
     * the price is of can no longer be read off `base`, since a price is turned to the side at
     * least one (MOL-81).
     */
    function costLineOf(cost: CurrencyCost): string {
      const words = {
        rate: rateOf(cost.rate),
        basis: t(basisKey(cost.basis), { date: dayOf(cost.rate.asOf) }),
      }
      return t(cost.estimated ? 'exchange.cost_line_estimated' : 'exchange.cost_line', words)
    }

    /** The spending currency came in and was priced: then «no wallet» is not «none came» (В′). */
    const pricedQuote = computed(() => {
      const value = exchanges.overview.value
      const quote = value?.pair?.quote
      if (!value || !quote) return false
      return value.receipts.some((one) => one.currency === quote && one.priced)
    })

    function choose(value: string): void {
      if (value === 'personal' || value === 'official') {
        void exchanges.prefer(value satisfies RatePreference)
      }
    }

    /**
     * The period of the line of the rate lives in the address (MOL-168, Р-5), as the mode of
     * «Графики» does: `?months=1` or `6`, the year with none — and anything else is the year. A
     * change is the screen's own query (MOL-136): not scrolled, not animated, nothing asked.
     */
    const chartMonths = computed<RateChartMonths>(
      () => RATE_CHART_MONTHS.find((months) => String(months) === route.query.months) ?? 12,
    )
    function chooseChartMonths(months: RateChartMonths): void {
      void router.replace({
        query: { ...route.query, months: months === 12 ? undefined : String(months) },
      })
    }

    return {
      t,
      ...exchanges,
      chartMonths,
      chooseChartMonths,
      today,
      sheetOpen,
      editing,
      compose,
      edit,
      amendEditing,
      removeOpen,
      removedStrip,
      recordButton,
      target,
      ask,
      confirmRemove,
      online,
      preferenceOptions,
      rateOf,
      dayOf,
      day,
      currencySignOf: (currency: Currency) => currencySign(currency, locale.value),
      pairSigns,
      costLineOf,
      basisKey,
      unknownLineOf,
      rateLineOf,
      amountsOf,
      choose,
      pricedQuote,
      IconSwap,
    }
  },
})
</script>

<style scoped lang="scss">
.losses,
.rate,
.frozen,
.strip {
  @include appear;

  margin-bottom: var(--space-4);
}

.caption {
  margin: 0 0 var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.figure {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-figure);
  font-variant-numeric: tabular-nums;
}

.meta {
  margin: var(--space-1) 0 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.preference {
  margin-top: var(--space-4);
}

.costs {
  margin: var(--space-2) 0 0;
  padding: var(--space-2) 0 0;
  border-top: var(--hairline) solid var(--border);
  list-style: none;
}

.frozen,
.strip {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius);
  font-size: var(--text-footnote);

  svg {
    flex: none;
    width: var(--space-5);
    height: var(--space-5);
  }
}

.frozen {
  background: var(--good-tint);
  color: var(--good-ink);
}

.strip {
  background: var(--warn-tint);
  color: var(--warn-ink);
}

.removed {
  align-items: center;
  justify-content: space-between;
  background: var(--surface-2);
  color: var(--text);
}

.removed-text {
  min-width: 0;
}

.failed {
  background: var(--bad-tint);
  color: var(--bad-ink);
}

/* Not `.list`: a scoped class of this screen lands on the root of a child card too, and `AppCard
   list` took this one's padding for «Обмен» (MOL-159). */
.exchanges {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-top: var(--space-6);

  // Room for «Обмен» under the last card: it floats over the list, as «Трата» does on the month.
  padding-bottom: calc(var(--space-8) + var(--space-8) + var(--space-6));
}

.exchanges .caption {
  margin: 0;
}

.cards {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.add {
  box-shadow: var(--shadow-md);
}
</style>
