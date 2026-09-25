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

    <ScreenSkeleton v-if="phase === 'loading'" :groups="[32, 64, 64]" />

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
        <AppCard class="rate">
          <p class="caption">{{ t('exchange.my_rate') }}</p>
          <template v-if="overview.wallet">
            <p class="figure">{{ rateOf(overview.wallet.rate) }}</p>
            <p class="meta">
              {{
                t(
                  overview.wallet.basis === 'weighted'
                    ? 'exchange.basis_weighted'
                    : 'exchange.basis_last',
                  { date: dayOf(overview.wallet.rate.asOf) },
                )
              }}
            </p>
            <p v-if="overview.wallet.estimated" class="meta">{{ t('exchange.estimated') }}</p>
          </template>
          <!-- Exchanges of the spending currency are there, its cost is not: the words say why, not
               «no exchanges yet» above a list of them (review С-4). -->
          <p v-else-if="overview.pair && overview.walletUnknown" class="meta">
            {{
              t('exchange.wallet_unknown', {
                given: currencySignOf(overview.walletUnknown.given),
                quote: pairSigns(overview.pair).quote,
                date: dayOf(midnightOf(overview.walletUnknown.exchangedOn)),
              })
            }}
          </p>
          <p v-else-if="overview.pair" class="meta">
            {{ t('exchange.no_wallet', pairSigns(overview.pair)) }}
          </p>
          <p v-else class="meta">{{ t('settings.same_currencies') }}</p>
          <p v-if="overview.pair && overview.baseSince" class="meta">
            {{
              t('exchange.base_since', {
                base: pairSigns(overview.pair).base,
                date: dayOf(midnightOf(overview.baseSince)),
              })
            }}
          </p>

          <!-- The currencies a chain went through, each at its own price: the drams' rate above
               is only as believable as the dollars' under it (MOL-42, Р-4). -->
          <ul v-if="overview.costs.length > 0" class="costs">
            <li v-for="cost in overview.costs" :key="cost.rate.base" class="meta">
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

        <AppButton ref="recordButton" block :inactive="!online || busy" @click="compose">
          <template #icon><IconPlus /></template>
          {{ t('exchange.record') }}
        </AppButton>

        <section class="list">
          <h2 class="caption">{{ t('exchange.list_title') }}</h2>
          <AppCard as="ul" list>
            <li v-for="exchange in overview.exchanges" :key="exchange.id" class="row">
              <!-- The row is the way into its amendment (MOL-42, В-3), as a verdict is amended
                   where it is met. -->
              <!-- No `aria-label`: it would replace the name whole, and the rate, the comparison
                   and the note would go silent (review С-3). The verb is said first, unseen. -->
              <button
                class="body"
                type="button"
                :disabled="!online || busy"
                @click="edit(exchange)"
              >
                <span class="verb">{{ t('exchange.edit') }}</span>
                <span class="amounts">
                  {{ amountsOf(exchange) }}
                  <span v-if="exchange.amendedAt" class="amended">{{
                    t('exchange.amended', { date: dayOf(exchange.amendedAt) })
                  }}</span>
                </span>
                <span class="meta">{{ rateLineOf(exchange) }}</span>
                <span class="meta">{{ comparisonOf(exchange) }}</span>
                <span v-if="exchange.note" class="meta note">{{ exchange.note }}</span>
              </button>
              <button
                class="remove"
                type="button"
                :disabled="!online || busy"
                :aria-label="t('exchange.remove', { amounts: amountsOf(exchange) })"
                @click="ask(exchange)"
              >
                <IconDelete aria-hidden="true" />
              </button>
            </li>
          </AppCard>
        </section>
      </template>
    </template>

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
import { defineComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { currencySign, formatMoney, formatRate, yerevanMidnight } from '@molvia/model'
import type {
  Currency,
  CurrencyCost,
  ExchangeAmendBody,
  ExchangeRate,
  ExchangeView as Row,
  RatePreference,
} from '@molvia/model'
import IconCheck from '~icons/mdi/check-bold'
import IconCloud from '~icons/mdi/cloud-off-outline'
import IconDelete from '~icons/mdi/trash-can-outline'
import IconPlus from '~icons/mdi/plus'
import IconSwap from '~icons/mdi/swap-horizontal'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppScreen from '@/components/AppScreen.vue'
import ExchangeRemoveSheet from '@/components/ExchangeRemoveSheet.vue'
import ExchangeSheet from '@/components/ExchangeSheet.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useExchanges } from '@/composables/useExchanges'
import type { AmendOutcome } from '@/composables/useExchanges'
import { purchaseDay } from '@/days'

/**
 * «Обмен денег» (MOL-40), under «Настройки»: the person's own rate, which rate new trips take, and
 * the exchanges it is worked out from, each beside the central bank of its day. Every figure is
 * the server's; the screen only chooses words — «больше» or «меньше», never «комиссия», because a
 * good exchanger beats the bank and the difference says nothing about why.
 */
export default defineComponent({
  name: 'ExchangeView',
  components: {
    AppButton,
    AppCard,
    AppScreen,
    ExchangeRemoveSheet,
    ExchangeSheet,
    ScreenSkeleton,
    ScreenState,
    SegmentedControl,
    IconCheck,
    IconCloud,
    IconDelete,
    IconPlus,
  },
  setup() {
    const { t, locale } = useI18n()
    const exchanges = useExchanges()
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

    const rateOf = (rate: ExchangeRate): string => formatRate(rate, locale.value)
    const dayOf = (when: Date): string => purchaseDay(when, locale.value)
    const midnightOf = (day: string): Date => yerevanMidnight(day)
    const pairSigns = (pair: { base: Currency; quote: Currency }) => ({
      base: currencySign(pair.base, locale.value),
      quote: currencySign(pair.quote, locale.value),
    })

    function amountsOf(exchange: Row): string {
      return t('exchange.row_amounts', {
        given: formatMoney(exchange.given, locale.value),
        received: formatMoney(exchange.received, locale.value),
      })
    }

    /** The day and the rate it was made at — the day alone for amounts no rate in the band says. */
    function rateLineOf(exchange: Row): string {
      const date = dayOf(midnightOf(exchange.exchangedOn))
      return exchange.rate ? t('exchange.row_rate', { date, rate: rateOf(exchange.rate) }) : date
    }

    function comparisonOf(exchange: Row): string {
      const official = exchange.official
      if (!official) {
        return t(exchange.officialDoubtful ? 'exchange.row_doubtful' : 'exchange.row_no_official')
      }
      const minor = official.difference.minor
      const words = {
        amount: formatMoney(
          { ...official.difference, minor: minor < 0n ? -minor : minor },
          locale.value,
        ),
        rate: rateOf(official.rate),
        date: dayOf(official.rate.asOf),
        source: t(`trip.rate.source_${official.provider}`),
      }
      // An open source is named instead of the central bank, never beside it: «чем по ЦБ РА ·
      // не ЦБ РА» said a thing and took it back in one line (review С-6).
      const bank = official.provider === 'cba'
      if (minor > 0n) return t(bank ? 'exchange.row_more' : 'exchange.row_more_other', words)
      if (minor < 0n) return t(bank ? 'exchange.row_less' : 'exchange.row_less_other', words)
      return t(bank ? 'exchange.row_equal' : 'exchange.row_equal_other', words)
    }

    /** «$: 89,04 ₽/$ · по последнему обмену · с 31 авг.» — and whether the bank priced part of it. */
    function costLineOf(cost: CurrencyCost): string {
      const words = {
        currency: currencySign(cost.rate.base, locale.value),
        rate: rateOf(cost.rate),
        basis: t(cost.basis === 'weighted' ? 'exchange.basis_weighted' : 'exchange.basis_last', {
          date: dayOf(cost.rate.asOf),
        }),
      }
      return t(cost.estimated ? 'exchange.cost_line_estimated' : 'exchange.cost_line', words)
    }

    function choose(value: string): void {
      if (value === 'personal' || value === 'official') {
        void exchanges.prefer(value satisfies RatePreference)
      }
    }

    return {
      t,
      ...exchanges,
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
      midnightOf,
      currencySignOf: (currency: Currency) => currencySign(currency, locale.value),
      pairSigns,
      costLineOf,
      rateLineOf,
      amountsOf,
      comparisonOf,
      choose,
      IconSwap,
    }
  },
})
</script>

<style scoped lang="scss">
.rate,
.frozen,
.strip {
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

.list {
  margin-top: var(--space-6);
}

.row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
}

.body {
  display: grid;
  flex: 1;
  min-width: 0;
  min-height: var(--touch-target);
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:focus-visible {
    @include focus-ring;
  }

  &:disabled {
    cursor: default;
  }
}

.amounts {
  margin: 0;
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
}

.verb {
  @include visually-hidden;
}

.amended {
  margin-left: var(--space-2);
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-regular);
}

.note {
  overflow-wrap: anywhere;
}

.remove {
  @include touch-target;

  flex: none;
  justify-content: center;
  width: var(--touch-target);
  border: 0;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;

  &:focus-visible {
    @include focus-ring;
  }

  &:disabled {
    opacity: var(--opacity-stale);
    cursor: default;
  }

  svg {
    width: var(--space-6);
    height: var(--space-6);
  }
}
</style>
