<template>
  <AppScreen :title="t('spending.title')">
    <template #subtitle>{{ t('spending.subtitle') }}</template>

    <div class="content">
      <template v-if="phase !== 'idle'">
        <MonthSwitcher :month="selected" :current="currentMonth" @change="goMonth" />

        <!-- Under the switcher, not over it as handoff 04 and MOL-157's 1e drew them: they belong to
             the month's answer and come and go with it, and over the switcher they took it from
             under the thumb (MOL-138, owner's decision В-2). A refusal of the queue too: it is a
             card here only while no row of the month carries it (adversarial round 3, Ж). -->
        <p v-if="phase === 'ready' && !online && fetchedAt" class="strip">
          <IconCloudOff class="strip-icon" aria-hidden="true" />
          {{ t('spending.summary.offline_strip', { when: whenOf(fetchedAt) }) }}
        </p>
        <p v-else-if="phase === 'ready' && stale === 'error' && fetchedAt" class="strip">
          {{ t('spending.error_strip', { when: whenOf(fetchedAt) }) }}
        </p>
        <AppReveal group>
          <ScreenState
            v-for="item in otherRefusals"
            :key="item.key"
            kind="attention"
            inline
            :title="t('spending.rejected_other.title')"
            :body="reasonOf(item.code)"
          >
            <template #action>
              <AppButton variant="ghost" @click="queue.dismiss(item)">
                {{ t('spending.sheet.dismiss') }}
              </AppButton>
            </template>
          </ScreenState>
        </AppReveal>
        <!-- A spending the server refused, of any month, is a row of «Не приняты» on top of «Траты»,
             put right there; the summary has no rows, so it counts them and leads there (MOL-159). -->
        <AppReveal>
          <ScreenState
            v-if="refusals.length > 0"
            kind="attention"
            inline
            :title="t('spending.summary.refused', { n: refusals.length }, refusals.length)"
            :body="t('spending.summary.refused_body')"
          >
            <template #action>
              <AppButton variant="ghost" @click="openSpendings">
                {{ t('spending.summary.refused_open') }}
              </AppButton>
            </template>
          </ScreenState>
        </AppReveal>

        <ScreenSkeleton v-if="phase === 'loading'" :groups="[24, 58, 40, 100, 30, 70, 52]" />

        <ScreenState
          v-else-if="phase === 'error'"
          kind="error"
          :title="t('spending.load_error.title')"
          :body="t('spending.load_error.body')"
          @retry="retry"
        />

        <!-- «Добавить трату» is the strip under the thumb in every state (handoff MOL-157 01). -->
        <ScreenState
          v-else-if="phase === 'offline'"
          kind="offline"
          tone="warn"
          :title="t('spending.offline.title')"
          :body="t('spending.offline.body')"
        />

        <ScreenState
          v-else-if="newcomer"
          kind="empty"
          tone="accent"
          :icon="IconWallet"
          :title="t('spending.empty.title')"
          :body="t('spending.empty.body')"
        />

        <template v-else-if="month">
          <AppCard class="spent">
            <p class="spent-head">
              <span class="caption">{{ t('spending.spent') }}</span>
              <span v-if="change" class="change">{{ change }}</span>
            </p>
            <p class="figure">{{ whole(month.spent) }}</p>
            <p v-if="month.spentIncome" class="approx">≈ {{ whole(month.spentIncome) }}</p>
            <p v-for="line in foreign" :key="line" class="footnote">{{ line }}</p>
            <p v-if="month.uncounted.length > 0" class="footnote">
              {{ t('spending.uncounted', { amounts: list(month.uncounted) }) }}
            </p>
            <p v-if="unsent > 0" class="footnote unsent">
              {{ t('spending.unsent', { n: unsent }, unsent) }}
            </p>

            <!-- Figures, not ways: «Доходы» and «Счета» are rows below — one way, one button
                 (handoff MOL-157 01). -->
            <div class="tiles">
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
              <!-- «Остаток» (MOL-134): the accounts at the end of the month, each figure with what
                   it misses; «—» says why from the answer, never a rate that is not the reason. A
                   closed month names its day: «На счетах 31 авг.». -->
              <div class="tile rest">
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

          <!-- An empty month keeps the card too: the way into «Графики» is there, the year is (Г). -->
          <CategoryDonutCard :month="month" :name-of="nameOf" :unsent="unsent + refusedHere" />
        </template>

        <!-- The ways out of the month, each with one figure: they stand by the error and under the
             skeleton too — a month that will not load must not close the way to the income that
             broke it (MOL-81; review Т-1, as MOL-66 argued) — but not offline with nothing kept,
             where the screens behind them would show nothing either. -->
        <MoneyEntries
          v-if="phase !== 'offline'"
          :month="selected === currentMonth ? null : selected"
          :values="entries"
          :spendings="!newcomer"
        />
      </template>
    </div>

    <!-- A spending is removed on «Траты», where its row is, and its «Вернуть» comes back here with
         the step back (adversarial round 2, Ж); a trip's is the app's, wherever the trip was removed
         from (MOL-76). Both over the strip. -->
    <FloatingDock v-if="removed || tripRemoved" class="float">
      <UndoStrip
        v-if="removed"
        :key="removed.stamp"
        :seconds="removed.left"
        :quiet="removed.quiet"
        :text="t('spending.removed', { title: removed.title, amount: removed.amount })"
        :announcement="
          t('spending.removed_announced', { title: removed.title, amount: removed.amount })
        "
        :action="t('spending.restore')"
        @restore="restore"
        @tick="keepLeft"
        @expire="forgetRemoved"
      />
      <TripUndoStrip v-else class="undo" />
    </FloatingDock>

    <!-- Wherever there is something to write it into, a slow answer and a broken server included
         (review Т-6), and offline on a month never read while another month names the categories. -->
    <template v-if="canWrite && phase !== 'idle'" #docked>
      <AppButton ref="addButton" size="large" block @click="compose()">
        <template #icon><IconPlus /></template>
        {{ t('spending.summary.add') }}
      </AppButton>
    </template>

    <SpendingSheet
      v-model:open="sheetOpen"
      :target="target"
      :categories="categories"
      :name-of="nameOf"
      :spend-currency="spendCurrency"
      :rate="liveRate"
      :online="online"
      :made="made"
      @add-category="newCategoryOpen = true"
      @saved="saved"
    />
    <NewCategorySheet
      v-model:open="newCategoryOpen"
      over
      :categories="categories"
      @created="made = $event"
    />
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import IconPlus from '~icons/mdi/plus'
import IconWallet from '~icons/mdi/wallet-outline'
import { formatEstimate, formatRate, lastDayOf, percentChange, previousMonth } from '@molvia/model'
import type { Money } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppReveal from '@/components/AppReveal.vue'
import AppScreen from '@/components/AppScreen.vue'
import CategoryDonutCard from '@/components/CategoryDonutCard.vue'
import FloatingDock from '@/components/FloatingDock.vue'
import MoneyEntries from '@/components/MoneyEntries.vue'
import type { EntryValues } from '@/components/MoneyEntries.vue'
import MonthSwitcher from '@/components/MonthSwitcher.vue'
import NewCategorySheet from '@/components/NewCategorySheet.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SpendingSheet from '@/components/SpendingSheet.vue'
import TripUndoStrip from '@/components/TripUndoStrip.vue'
import UndoStrip from '@/components/UndoStrip.vue'
import { pageOrder } from '@/components/accounts'
import { rateWords } from '@/components/spending'
import { useMoneyScreen } from '@/composables/useMoneyScreen'
import { useReconnect } from '@/composables/useReconnect'
import { calendarDay } from '@/days'
import { useAccountsOnScreen, useAccountsStore } from '@/stores/accounts'
import { useSpendingHandoffStore } from '@/stores/spendingHandoff'

/**
 * «Деньги» (MOL-82, MOL-159, handoff MOL-157 01): the summary of one month, counted by the server —
 * what was spent and how it compares, what came in, what is on the accounts, where it went — and
 * the ways into everything else, each with one figure. The journal is «Траты»'s; the phone adds
 * nothing up. The month is in the address and moves by `replace`: looking at August is not a step
 * the system «back» should walk through.
 */
export default defineComponent({
  name: 'MoneyView',
  components: {
    AppButton,
    AppCard,
    AppReveal,
    AppScreen,
    CategoryDonutCard,
    FloatingDock,
    IconCloudOff,
    IconPlus,
    MoneyEntries,
    MonthSwitcher,
    NewCategorySheet,
    ScreenSkeleton,
    ScreenState,
    SpendingSheet,
    TripUndoStrip,
    UndoStrip,
  },
  setup() {
    const { t, locale } = useI18n()
    const screen = useMoneyScreen()
    const { month, queue, currentMonth } = screen
    // «Добавить трату», where the focus goes once «Вернуть» has done its work.
    const { addButton } = screen

    // The number of accounts beside «Счета»: «now», not the month's, whatever month is open.
    const accounts = useAccountsStore()
    useAccountsOnScreen()
    onMounted(() => void accounts.refresh())
    useReconnect(() => void accounts.refresh())

    /**
     * «Пусто» is somebody with nothing yet — no spending, no trip, no income (Р-6). The server
     * does not say so; the running month with nothing in it, nothing the month before and
     * nothing waiting is as near as its answer gets. An empty August after a full July is a
     * month, not a newcomer.
     */
    const newcomer = computed(() => {
      const value = month.value
      return (
        !!value &&
        value.month === currentMonth.value &&
        value.days.length === 0 &&
        value.income.minor === 0n &&
        value.previousSpent === null &&
        !queue.pending.some((write) => write.kind === 'record') &&
        queue.rejected.length === 0
      )
    })

    /** Refused spendings typed into the month shown: «Куда ушли» does not say «трат нет» over them. */
    const refusedHere = computed(
      () =>
        screen.refusals.value.filter((row) =>
          row.spending.spentOn.startsWith(screen.selected.value),
        ).length,
    )
    const number = (value: number) => new Intl.NumberFormat(locale.value).format(value)
    /** One figure a row, and none until it is known (handoff MOL-157 01). */
    const entries = computed<EntryValues>(() => {
      const value = month.value
      const live = accounts.overview ? pageOrder(accounts.accounts).length : null
      const rate = screen.liveRate.value
      return {
        spendings: value?.count == null ? null : number(value.count),
        accounts: live === null ? null : number(live),
        rate: rate?.source === 'personal' ? formatRate(rate, locale.value) : null,
        incomes: value?.incomeCount == null ? null : number(value.incomeCount),
        categories:
          screen.knownCategories.value.length > 0
            ? number(screen.knownCategories.value.filter((category) => !category.archived).length)
            : null,
      }
    })

    const whole = (value: Money) => formatEstimate(value, locale.value)
    const signed = (value: Money) =>
      value.minor < 0n
        ? `−${formatEstimate({ ...value, minor: -value.minor }, locale.value)}`
        : formatEstimate(value, locale.value)
    const list = (values: readonly Money[]) => values.map(whole).join(', ')
    const shortDay = (day: string) =>
      calendarDay(day, locale.value, { day: 'numeric', month: 'short' })
    const days = (values: readonly string[]) => values.map(shortDay).join(', ')

    /** «Остаток на счетах», and of a closed month the day it is of: «На счетах 31 авг.». */
    const restLabel = computed(() => {
      const value = month.value
      return value && value.month < currentMonth.value
        ? t('spending.rest_on', { date: shortDay(lastDayOf(value.month)) })
        : t('spending.rest')
    })

    // What each figure of «Остаток» misses, in the server's words (MOL-134, adversarial А, Б, З):
    // «без сбережений» is drawn only where it says something «всего» does not.
    const restNotes = computed(() => {
      const rest = month.value?.rest
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
      const value = month.value
      if (!value?.previousSpent) return null
      const percent = percentChange(value.spent, value.previousSpent)
      if (percent === null) return null
      const text = new Intl.NumberFormat(locale.value, { style: 'percent' }).format(
        Math.abs(percent) / 100,
      )
      const sign = percent < 0 ? '−' : percent > 0 ? '+' : ''
      const previous = previousMonth(value.month).slice(5)
      return t('spending.vs_previous', {
        percent: `${sign}${text}`,
        month: t(`spending.month_to.${previous}`),
      })
    })

    const foreign = computed(() =>
      (month.value?.foreign ?? []).map(({ amount, counted }) =>
        t('spending.foreign_part', {
          amount: formatEstimate(amount, locale.value),
          counted: whole(counted),
        }),
      ),
    )

    const rateLine = computed(() => {
      const value = month.value
      if (!value?.rate) return t('spending.rate_none')
      const rate = rateWords(value.rate, locale.value, t)
      if (value.rateKind === 'frozen') {
        const date = calendarDay(lastDayOf(value.month), locale.value)
        return t('spending.rate_frozen', { date, rate })
      }
      return value.rate.source === 'personal'
        ? t('spending.rate_live_mine', { rate })
        : t('spending.rate_live_official', { rate })
    })

    /**
     * A record with no purchases handed over from «Покупки» (MOL-78, В-1): the sheet opens on it
     * once, as soon as this screen is there.
     */
    const handoff = useSpendingHandoffStore()
    watch(
      () => handoff.handed,
      (handed) => {
        if (!handed) return
        const prefill = handoff.take()
        if (prefill) screen.compose(prefill)
      },
      { immediate: true },
    )

    /**
     * The summary stays on its month whatever month the spending went into — there is no row here
     * to bring into view; «Траты» go to it (handoff MOL-157 06, Р-5).
     */
    const router = useRouter()
    function openSpendings(): void {
      const month = screen.selected.value
      void router.push({
        name: 'money-spendings',
        query: month === currentMonth.value ? {} : { month },
      })
    }

    function saved(): void {
      screen.lookAtToday()
      if (!screen.online.value) screen.announce?.(t('spending.saved_offline'))
    }

    return {
      ...screen,
      addButton,
      t,
      IconWallet,
      newcomer,
      refusedHere,
      entries,
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
      saved,
      openSpendings,
    }
  },
})
</script>

<style scoped lang="scss">
.content {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: var(--space-3);
  padding: var(--space-4);
}

.strip {
  @include appear;

  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3);
  border-radius: var(--radius);
  background: var(--warn-tint);
  color: var(--warn-ink);
  font-size: var(--text-footnote);
}

.strip-icon {
  flex: none;
  width: 1.125rem;
  height: 1.125rem;
}

.spent {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-4);
}

.spent-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  margin: 0;
}

.caption {
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.change {
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.figure {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-figure);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.approx {
  margin: 0;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
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

.float > .undo {
  flex: 1;
}

/* The answer comes in where the skeleton stood, faded only: the screen keeps it in one block of its
   own, which `AppScreen` does not see, and nothing under the thumb may move (review №5, MOL-138). */
.content > * {
  @include appear(0);
}
</style>
