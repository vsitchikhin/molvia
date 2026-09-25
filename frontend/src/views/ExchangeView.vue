<template>
  <AppScreen :title="t('exchange.title')">
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
          <AppButton block :inactive="!online" @click="sheetOpen = true">
            {{ t('exchange.record') }}
          </AppButton>
        </template>
      </ScreenState>

      <template v-else-if="overview">
        <p v-if="!online" class="strip">
          <IconCloud aria-hidden="true" />{{ t('exchange.offline.strip') }}
        </p>
        <p v-if="failed" class="strip failed" role="alert">{{ t('exchange.failed') }}</p>

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
          </template>
          <p v-else-if="overview.pair" class="meta">
            {{ t('exchange.no_wallet', pairSigns(overview.pair)) }}
          </p>
          <p v-else class="meta">{{ t('settings.same_currencies') }}</p>

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

        <AppButton block :inactive="!online || busy" @click="sheetOpen = true">
          <template #icon><IconPlus /></template>
          {{ t('exchange.record') }}
        </AppButton>

        <section class="list">
          <h2 class="caption">{{ t('exchange.list_title') }}</h2>
          <AppCard as="ul" list>
            <li v-for="exchange in overview.exchanges" :key="exchange.id" class="row">
              <div class="body">
                <p class="amounts">{{ amountsOf(exchange) }}</p>
                <p class="meta">{{ rateLineOf(exchange) }}</p>
                <p class="meta">{{ comparisonOf(exchange) }}</p>
              </div>
              <button
                class="remove"
                type="button"
                :disabled="!online || busy"
                :aria-label="t('exchange.remove', { amounts: amountsOf(exchange) })"
                @click="remove(exchange.id)"
              >
                <IconDelete aria-hidden="true" />
              </button>
            </li>
          </AppCard>
          <p class="meta">{{ t('exchange.remove_note') }}</p>
        </section>
      </template>
    </template>

    <ExchangeSheet v-if="overview" v-model:open="sheetOpen" :overview="overview" :record="record" />
  </AppScreen>
</template>

<script lang="ts">
import { defineComponent, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { currencySign, formatMoney, formatRate, yerevanMidnight } from '@molvia/model'
import type { Currency, ExchangeRate, ExchangeView as Row, RatePreference } from '@molvia/model'
import IconCheck from '~icons/mdi/check-bold'
import IconCloud from '~icons/mdi/cloud-off-outline'
import IconDelete from '~icons/mdi/trash-can-outline'
import IconPlus from '~icons/mdi/plus'
import IconSwap from '~icons/mdi/swap-horizontal'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppScreen from '@/components/AppScreen.vue'
import ExchangeSheet from '@/components/ExchangeSheet.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { useExchanges } from '@/composables/useExchanges'
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

    function choose(value: string): void {
      if (value === 'personal' || value === 'official') {
        void exchanges.prefer(value satisfies RatePreference)
      }
    }

    return {
      t,
      ...exchanges,
      sheetOpen,
      online,
      preferenceOptions,
      rateOf,
      dayOf,
      pairSigns,
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
  flex: 1;
  min-width: 0;
}

.amounts {
  margin: 0;
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
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
