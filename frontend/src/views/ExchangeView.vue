<template>
  <AppScreen :title="t('exchange.title')">
    <template v-if="overview && phase !== 'loading'">
      <!-- The connection in one line, with the time of the answer shown (MOL-181, Ф-14). Nothing is
           kept on the phone, but an app stays open for days: «на 14:05» of yesterday would be untrue. -->
      <!-- The switch of the rate is named only where it stands: on the empty screen and with one
           currency there is nothing but «Записать обмен» that waits for the connection. -->
      <StatusStrip
        v-if="!online && fetchedAt"
        class="status"
        kind="offline"
        :text="
          phase === 'ready' && overview.pair
            ? t('exchange.offline.strip', { when: whenOf(fetchedAt) })
            : t('exchange.offline.strip_record', { when: whenOf(fetchedAt) })
        "
      />
      <!-- The list read again after a write's answer — a conflict, a vanished exchange, a late
           «Вернуть» — did not come: what is shown may no longer be what the server holds. The strip
           over the tab bar holds «Записать обмен», so «Повторить» is here (К-5). -->
      <StatusStrip
        v-else-if="stale && fetchedAt"
        class="status"
        kind="unanswered"
        :text="t('exchange.error_strip', { when: whenOf(fetchedAt) })"
        :attempt="attempt"
      >
        <template #action>
          <AppButton variant="ghost" @click="retry">{{ t('state.retry') }}</AppButton>
        </template>
      </StatusStrip>
      <p v-if="failed" class="notice failed" role="alert">{{ t('exchange.failed') }}</p>
      <!-- Read again and not answered — the server silent or the connection gone (round 2, Б1) — the
           list is the one from before the write: «показываем, как он записан» over it would be untrue,
           and the strip is all that says the exchange is there. -->
      <p v-if="conflicted" class="notice" role="alert">
        {{ behind ? t('exchange.conflict_stale') : t('exchange.conflict') }}
      </p>
      <p v-if="amendConflicted" class="notice" role="alert">
        {{ behind ? t('exchange.amend_conflict_stale') : t('exchange.amend_conflict') }}
      </p>
      <p v-if="vanished" class="notice" role="alert">
        {{ behind ? t('exchange.vanished_stale') : t('exchange.vanished') }}
      </p>
      <p v-if="gone" class="notice" role="alert">{{ t('exchange.restore_gone') }}</p>
    </template>

    <!-- The shape of what is coming, in the order it will stand (Ф-13): «Обмены против рынка», the
         line of the rate, the card of the rate with its switch, «Обмены» and the cards of exchanges. -->
    <ScreenSkeleton v-if="phase === 'loading'">
      <SkeletonPart kind="figure" />
      <!-- The line of the rate is the screen's own: its caption, the period, the reading, the area. -->
      <AppCard class="ghost-chart">
        <span class="ghost-heading"><span class="ghost-bar ghost-caption"></span></span>
        <span class="ghost-bar ghost-control"></span>
        <span class="ghost-bar ghost-figure"></span>
        <span class="ghost-bar ghost-area"></span>
      </AppCard>
      <SkeletonPart kind="figure" plate />
      <SkeletonPart kind="caption" :width="20" />
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
           one the trips simply keep counting by the central bank (MOL-40, В-3). «Записать обмен» is
           the strip's, as on a screen with exchanges (Ф-16). -->
      <ScreenState
        v-else-if="phase === 'empty'"
        kind="empty"
        :icon="IconSwap"
        :title="t('exchange.empty.title')"
        :body="t('exchange.empty.body', { bank })"
      />

      <template v-else-if="overview">
        <!-- First under the strips (handoff MOL-157 05): what the exchanges of a year gave against
             the market, by place — moved here from «Графики» (MOL-159, MOL-152). No card when
             nothing of the twelve months was measured. -->
        <ExchangeLosses v-if="overview.losses" :losses="overview.losses" />
        <!-- Under it (handoff MOL-157 05): when the exchanges were made, against the market of all
             bank clients by day or week (MOL-161), the period from the address (MOL-168). -->
        <ExchangeRateChart
          v-if="overview.rateCharts"
          :chart="overview.rateCharts"
          :months="chartMonths"
          @update:months="chooseChartMonths"
        />

        <AppCard class="rate">
          <SectionCaption as="p" inset class="rate-caption">{{
            t('exchange.my_rate')
          }}</SectionCaption>
          <template v-if="overview.wallet">
            <p class="figure">{{ rateOf(overview.wallet.rate) }}</p>
            <p class="meta">
              {{ t(basisKey(overview.wallet.basis), { date: dayOf(overview.wallet.rate.asOf) }) }}
            </p>
            <p v-if="overview.wallet.estimated" class="meta">
              {{ t('exchange.estimated', { bank }) }}
            </p>
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
            :inactive="!online || busy"
            @update:model-value="choose"
          />
          <p v-if="overview.pair" class="meta">{{ t('exchange.preference_hint', { bank }) }}</p>
        </AppCard>

        <p class="frozen"><IconCheck aria-hidden="true" />{{ t('money.rate_frozen') }}</p>

        <MarketRatesCard class="market-rates" :rows="overview.marketToday" />

        <!-- Incomes alone can make the rate (MOL-66): then there is the card, and no list. -->
        <section v-if="overview.exchanges.length > 0" class="exchanges">
          <SectionCaption>{{ t('exchange.list_title') }}</SectionCaption>
          <!-- A list, so a screen reader says how many and moves item by item (review Т-5). -->
          <ul class="cards">
            <AppReveal group>
              <li v-for="exchange in overview.exchanges" :key="exchange.id">
                <ExchangeCard :exchange="exchange" :today="today" @edit="edit" />
              </li>
            </AppReveal>
          </ul>
        </section>
      </template>
    </template>

    <!-- «Записать обмен» stands in the strip over the tab bar, never over the last card (Ф-28):
         with exchanges and on the empty screen alike, not while there is no answer yet. Without a
         connection it stays, not now, and says why on itself (Ф-6, Р-1). -->
    <!-- «Вернуть» over the strip, ten seconds, one look for every operation of «Деньги» (MOL-189,
         Ф-29). Whatever the screen became under it: removing the last exchange leaves the empty state
         (В-5). The strip puts the focus on «Вернуть» and says the removal itself. -->
    <template v-if="removed && !landing.includes(removed.id)" #undo>
      <UndoStrip
        :key="removed.id"
        :text="t('exchange.removed', { amounts: amountsOf(removed) })"
        :announcement="t('exchange.removed_announced', { amounts: amountsOf(removed) })"
        :action="t('exchange.restore')"
        :busy="restoring"
        :busy-label="t('exchange.restoring')"
        :waiting="!online && !restoring"
        :waiting-action="t('exchange.restore_offline')"
        :inactive="busy && !restoring"
        @restore="restore"
        @expire="forget"
      />
    </template>

    <template v-if="phase === 'ready' || phase === 'empty'" #docked>
      <AppButton ref="recordButton" size="large" block :inactive="!online || busy" @click="compose">
        <template #icon><IconPlus /></template>
        {{ online ? t('exchange.record') : t('exchange.record_offline') }}
      </AppButton>
    </template>

    <ExchangeSheet
      v-if="overview"
      v-model:open="sheetOpen"
      :overview="overview"
      :editing="editing"
      :record="record"
      :amend="amend"
      removable
      :busy="busy"
      :behind="behind"
      :stale="stale"
      :attempt="attempt"
      :remove-failed="amendFailed"
      @remove="ask"
      @retry="retry"
      @closed="landed"
    />
    <!-- Over the sheet of the amendment, «‹» back to it (Д-1). -->
    <ExchangeRemoveSheet
      v-model:open="removeOpen"
      :exchange="target"
      :amounts="target ? `${amountsOf(target)} · ${rateLineOf(target)}` : ''"
      :busy="busy"
      :failed="removeFailed"
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
import IconCheck from '~icons/mdi/check'
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
import OperationSkeleton from '@/components/OperationSkeleton.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import SkeletonPart from '@/components/SkeletonPart.vue'
import StatusStrip from '@/components/StatusStrip.vue'
import UndoStrip from '@/components/UndoStrip.vue'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useExchangeWords } from '@/composables/useExchangeWords'
import { useExchanges } from '@/composables/useExchanges'
import { useLocalDay } from '@/composables/useLocalDay'
import { useAccountsOnScreen, useAccountsStore } from '@/stores/accounts'
import { bankWords } from '@/components/spending'
import { answeredAt } from '@/days'

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
    IconCheck,
    IconPlus,
    MarketRatesCard,
    OperationSkeleton,
    ScreenSkeleton,
    ScreenState,
    SectionCaption,
    SegmentedControl,
    SkeletonPart,
    StatusStrip,
    UndoStrip,
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
    // «Удалить обмен?» first, then «Вернуть» after (В-5): the bin never removes on its own. Asked from
    // the sheet of the amendment and over it (MOL-189, Ф-34), «‹» back to what was typed there.
    const removeOpen = ref(false)
    const target = ref<Row | null>(null)
    function ask(exchange: Row): void {
      target.value = exchange
      removeOpen.value = true
    }
    // «Вернуть» goes with its strip once it worked: the words say the exchange is back, and the
    // focus goes to «Записать обмен», the one button that is always there (review Т-3).
    const recordButton = ref<{ $el: HTMLElement } | null>(null)
    const announce = useAnnouncer()
    let unsay: (() => void) | undefined
    watch(exchanges.restored, async (back) => {
      if (!back) return
      unsay?.()
      unsay = announce?.(t('exchange.restored'))
      await nextTick()
      recordButton.value?.$el.focus()
    })
    onUnmounted(() => unsay?.())

    // Both sheets stay up until the server answers (MOL-189, adversarial А3, А5): «Удаляем…» is seen,
    // the card is not opened again under it, and a removal that failed leaves what was typed. The
    // strip waits for the sheets to go, or its focus and its words land in a sheet on its way out.
    const removeFailed = ref(false)
    watch(removeOpen, (open) => {
      if (!open) removeFailed.value = false
    })
    // The removals whose strip waits while a sheet of the amendment is up — its own, or one opened over
    // another card while the answer was on its way: under a modal sheet «Вернуть» cannot be reached, and
    // its ten seconds ran out there (adversarial Б2). Every one that waits, not the last: a second removal
    // from the sheet it waits behind let the first strip under both sheets (В1). One standing stays.
    const landing = ref<string[]>([])
    // The sheet of the amendment is on the screen: from its opening until `@closed`, never by the
    // prop alone, which goes false while the sheet is still on its way out.
    const sheetUp = ref(false)
    watch(sheetOpen, (open) => {
      if (open) sheetUp.value = true
    })
    // A removal that failed once its question was put away, said in the amendment still up over the
    // same exchange: the screen's word is under the modal sheet, read by nobody (В2).
    const amendFailed = ref(false)
    let removing = false
    async function confirmRemove(): Promise<void> {
      const exchange = target.value
      if (!exchange || exchanges.busy.value) return
      removeFailed.value = false
      amendFailed.value = false
      landing.value = [...landing.value, exchange.id]
      removing = true
      await exchanges.remove(exchange)
      removing = false
      const failed = exchanges.removed.value?.id !== exchange.id
      if (failed) {
        landing.value = landing.value.filter((id) => id !== exchange.id)
        // Said in the question only while it stands: put away meanwhile, the next one opened — of
        // another exchange too — read out a failure nobody pressed for (adversarial Б1).
        removeFailed.value = removeOpen.value
        amendFailed.value =
          !removeOpen.value && sheetOpen.value && editing.value?.id === exchange.id
      }
      // Closing the amendment closes the question over it too, in one step of the history: the
      // stack steps over the sheets above the one closed. Each closed on its own would step back twice.
      if (!failed && sheetOpen.value && editing.value?.id === exchange.id) sheetOpen.value = false
      if (!sheetUp.value) landing.value = []
    }
    function landed(): void {
      sheetUp.value = false
      amendFailed.value = false
      if (!removing) landing.value = []
    }
    // The amendment's own save is the sheet's next write: the word about the removal before it goes,
    // as the sheet's own word does (MOL-19, MOL-181; review №4, adversarial Г1).
    function amend(id: string, body: ExchangeAmendBody): ReturnType<typeof exchanges.amend> {
      amendFailed.value = false
      return exchanges.amend(id, body)
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

    /**
     * The bank new trips take when no own rate is known: the one of the pair «Обмен денег» speaks of
     * — the spending currency in the currency of conversion (MOL-110) — and the dram's otherwise.
     */
    const bank = computed(() => {
      const pair = exchanges.overview.value?.pair
      return pair ? bankWords(pair.base, pair.quote, t) : t('exchange.card_source_cba')
    })
    const preferenceOptions = computed(() => [
      { value: 'personal', label: t('exchange.preference_personal') },
      { value: 'official', label: t('exchange.preference_official', { bank: bank.value }) },
    ])

    // «14 окт., 14:05» — the answer's day and time, as «Деньги» and «Траты» print it; by the day
    // the screen holds, so a night offline turns «сегодня» into «вчера» (adversarial А2).
    const whenOf = (at: Date): string => answeredAt(at, locale.value, today.value)
    // The day a rate is dated by, as a calendar day of Yerevan (adversarial Ж).
    const dayOf = (when: Date): string => day(yerevanDate(when))
    const pairSigns = (pair: { base: Currency; quote: Currency }) => ({
      base: currencySign(pair.base, locale.value),
      quote: currencySign(pair.quote, locale.value),
      bank: bankWords(pair.base, pair.quote, t),
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
        // The rate missing is the given currency's in the currency of conversion (MOL-110).
        dayBank: bankWords(unknown.given, pair.base, t),
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
        bank: bankWords(cost.rate.base, cost.rate.quote, t),
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
      amend,
      chartMonths,
      chooseChartMonths,
      today,
      sheetOpen,
      editing,
      compose,
      edit,
      removeOpen,
      recordButton,
      target,
      ask,
      confirmRemove,
      removeFailed,
      landing,
      amendFailed,
      landed,
      online,
      preferenceOptions,
      bank,
      rateOf,
      dayOf,
      day,
      whenOf,
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
.notice {
  @include appear;
}

// Strips over the answer stand 16 apart; the groups of the answer 24 (Ф-10), and «Мой курс» with
// the note under it is one group, 8 apart.
// `margin`, not its bottom alone: a notice and the note are paragraphs, and the browser's 1em above
// them stood on top of the 16 and the 8.
.notice,
.status {
  margin: 0 0 var(--space-4);
}

// Each space has one owner, the group above it: with no rates of the central bank a margin of
// «Обмены» on top of the note's made 48.
.losses,
.rate-chart,
.frozen,
.market-rates {
  margin-bottom: var(--space-6);
}

.rate {
  margin-bottom: var(--space-2);
}

.rate-caption {
  margin-bottom: var(--space-2);
}

.figure {
  @include display-type;

  margin: 0;
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
.notice {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius);
  font-size: var(--text-footnote);

  svg {
    @include icon;

    font-size: var(--icon-sm);
  }
}

// A note, not «хорошо»: nothing good is reported here (Ф-4).
.frozen {
  margin-top: 0;
  background: var(--surface-2);
  color: var(--text-muted);
}

.notice {
  background: var(--warn-tint);
  color: var(--warn-ink);
}

.failed {
  background: var(--bad-tint);
  color: var(--bad-ink);
}

/* The line of the rate while the screen is coming: as tall as its caption, period, reading and area. */
.ghost-chart {
  display: grid;
  gap: var(--space-3);
}

.ghost-heading {
  display: flex;
  align-items: center;
  height: calc(1em * var(--leading-body));
  font-size: var(--text-callout);
}

.ghost-bar {
  @include skeleton-bar;

  height: var(--skeleton-caption);
}

.ghost-caption {
  width: 40%;
}

.ghost-control {
  height: var(--touch-target);
  border-radius: var(--radius);
}

.ghost-figure {
  width: 36%;
  height: var(--skeleton-figure);
}

// The height of the chart's area in `ExchangeRateChart` — changed there, changed here.
.ghost-area {
  height: 11.25rem;
  border-radius: var(--radius-sm);
}

.cards {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
