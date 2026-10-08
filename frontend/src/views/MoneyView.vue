<template>
  <AppScreen :title="t('spending.title')">
    <template #subtitle>{{ t('spending.subtitle') }}</template>

    <div class="content">
      <template v-if="phase !== 'idle'">
        <!-- «Now», not the month's (MOL-183, Ф-27): over the switcher, where turning the months does
             not move it; drawn once «Счета» have answered or the phone keeps them, never animated in —
             a height grown there takes the switcher from under the thumb (MOL-138). -->
        <MoneyAccountsNow
          v-if="accountsNow"
          :totals="accountsNow.totals"
          :live="accountsNow.live"
        />

        <div class="month">
          <MonthSwitcher :month="selected" :current="currentMonth" @change="goMonth" />

          <!-- Under the switcher, not over it as handoff 04 and MOL-157's 1e drew them: they belong to
               the month's answer and come and go with it, and over the switcher they took it from
               under the thumb (MOL-138, owner's decision В-2). A refusal of the queue too: it is a
               card here only while no row of the month carries it (adversarial round 3, Ж). -->
          <StatusStrip
            v-if="phase === 'ready' && !online && fetchedAt"
            kind="offline"
            :text="t('spending.summary.offline_strip', { when: whenOf(fetchedAt) })"
          />
          <StatusStrip
            v-else-if="phase === 'ready' && stale === 'error' && fetchedAt"
            kind="unanswered"
            :text="t('spending.error_strip', { when: whenOf(fetchedAt) })"
            :attempt="attempt"
          />
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
          <!-- A spending the server refused, of any month, is a row of «Не приняты» on top of
               «Траты», put right there; the summary has no rows, so it counts them and leads there
               (MOL-159). -->
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

          <!-- The answer's shape (MOL-178, MOL-183): the month's card — its figure where the
               answer's stands, its tiles where the plate is — then «Куда ушли». -->
          <ScreenSkeleton v-if="phase === 'loading'">
            <SkeletonPart kind="figure" approx plate />
            <!-- «Куда ушли» is the screen's own: a ring and three lines beside it. -->
            <AppCard class="ghost-donut">
              <span class="ghost-heading"><span class="ghost-bar ghost-caption"></span></span>
              <span class="ghost-figure">
                <span class="ghost-ring"></span>
                <span class="ghost-lines">
                  <span v-for="n in 3" :key="n" class="ghost-bar ghost-line"></span>
                </span>
              </span>
            </AppCard>
          </ScreenSkeleton>

          <!-- A section's error, not the screen's: «Добавить трату» keeps the strip, since a
               spending goes through the queue with the server down (157 v2, 1k/2e; MOL-180, В-1). -->
          <ScreenState
            v-else-if="phase === 'error'"
            kind="error"
            inline
            :title="t('spending.load_error.title')"
            :body="t('spending.load_error.body')"
            @retry="retry"
          />

          <!-- «Можно записать и сейчас» only where the strip offers it (Е-7). -->
          <ScreenState
            v-else-if="phase === 'offline'"
            kind="offline"
            tone="warn"
            :title="t('spending.offline.title')"
            :body="t(canWrite ? 'spending.offline.body' : 'spending.offline.body_read')"
          />

          <ScreenState
            v-else-if="newcomer"
            kind="empty"
            :icon="IconWallet"
            :title="t('spending.empty.title')"
            :body="t('spending.empty.body')"
          />

          <template v-else-if="month">
            <MoneyMonthCard :month="month" :current="currentMonth" :unsent="unsent" />
          </template>
        </div>

        <!-- An empty month keeps the card too: the way into «Графики» is there, the year is (Г). -->
        <CategoryDonutCard
          v-if="phase === 'ready' && month && !newcomer"
          :month="month"
          :name-of="nameOf"
          :pending="unsent"
          :refused="refusedHere"
          :running="month.month === currentMonth"
        />

        <!-- The ways out of the month, each with one figure: they stand by the error and under the
             skeleton too — a month that will not load must not close the way to the income that
             broke it (MOL-81; review Т-1, as MOL-66 argued) — but not offline with nothing kept,
             where the screens behind them would show nothing either. -->
        <MoneyEntries
          v-if="phase !== 'offline'"
          :month="selected === currentMonth ? null : selected"
          :values="entries"
          :spendings="!newcomer"
          :accounts="!accountsNow"
        />
      </template>
    </div>

    <!-- A spending is removed on «Траты», where its row is, and its «Вернуть» comes back here with
         the step back (adversarial round 2, Ж); a trip's is the app's, wherever the trip was removed
         from (MOL-76). Both over the strip. -->
    <template v-if="removed || tripRemoved" #undo>
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
      <TripUndoStrip v-else />
    </template>

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
import IconPlus from '~icons/mdi/plus'
import IconWallet from '~icons/mdi/wallet-outline'
import { formatRate } from '@molvia/model'
import type { MoneyMonthView } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppReveal from '@/components/AppReveal.vue'
import AppScreen from '@/components/AppScreen.vue'
import CategoryDonutCard from '@/components/CategoryDonutCard.vue'
import MoneyAccountsNow from '@/components/MoneyAccountsNow.vue'
import MoneyEntries from '@/components/MoneyEntries.vue'
import type { EntryValues } from '@/components/MoneyEntries.vue'
import MoneyMonthCard from '@/components/MoneyMonthCard.vue'
import MonthSwitcher from '@/components/MonthSwitcher.vue'
import NewCategorySheet from '@/components/NewCategorySheet.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SkeletonPart from '@/components/SkeletonPart.vue'
import SpendingSheet from '@/components/SpendingSheet.vue'
import StatusStrip from '@/components/StatusStrip.vue'
import TripUndoStrip from '@/components/TripUndoStrip.vue'
import UndoStrip from '@/components/UndoStrip.vue'
import { pageOrder } from '@/components/accounts'
import { budgetAmount } from '@/components/spending'
import { useMoneyScreen } from '@/composables/useMoneyScreen'
import { useReconnect } from '@/composables/useReconnect'
import { useAccountsOnScreen, useAccountsStore } from '@/stores/accounts'
import { useSpendingHandoffStore } from '@/stores/spendingHandoff'

/**
 * «Деньги» (MOL-82, MOL-159, MOL-183, handoff MOL-157 v2 01): what is on the accounts now, then the
 * summary of one month, counted by the server — what was spent and how it compares, what came in,
 * where it went — and the ways into everything else, each with one figure. The journal is «Траты»'s;
 * the phone adds nothing up. The month is in the address and moves by `replace`: looking at August
 * is not a step the system «back» should walk through.
 */
export default defineComponent({
  name: 'MoneyView',
  components: {
    AppButton,
    AppCard,
    AppReveal,
    AppScreen,
    CategoryDonutCard,
    IconPlus,
    MoneyAccountsNow,
    MoneyEntries,
    MoneyMonthCard,
    MonthSwitcher,
    NewCategorySheet,
    ScreenSkeleton,
    ScreenState,
    SkeletonPart,
    SpendingSheet,
    StatusStrip,
    TripUndoStrip,
    UndoStrip,
  },
  setup() {
    const { t, locale } = useI18n()
    const screen = useMoneyScreen()
    const { month, queue, currentMonth } = screen
    // «Добавить трату», where the focus goes once «Вернуть» has done its work.
    const { addButton } = screen

    // «На счетах сейчас»: «now», not the month's, whatever month is open.
    const accounts = useAccountsStore()
    useAccountsOnScreen()
    onMounted(() => void accounts.refresh())
    useReconnect(() => void accounts.refresh())

    /**
     * «На счетах сейчас» (MOL-183, С-10): there while a live account is — answered or kept on the
     * phone. With none, or no answer of «Счета» at all, «Счета» is a row among the ways out instead.
     */
    const accountsNow = computed(() => {
      const totals = accounts.overview?.incomeTotals
      const live = accounts.overview ? pageOrder(accounts.accounts).length : 0
      return totals && live > 0 ? { totals, live } : null
    })

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
      const rate = screen.liveRate.value
      return {
        spendings: value?.count == null ? null : number(value.count),
        budget: budgetWords(value?.budget ?? null),
        rate: rate?.source === 'personal' ? formatRate(rate, locale.value) : null,
        incomes: value?.incomeCount == null ? null : number(value.incomeCount),
        categories:
          screen.knownCategories.value.length > 0
            ? number(screen.knownCategories.value.filter((category) => !category.archived).length)
            : null,
      }
    })

    /** The month's «Бюджет» in one figure (MOL-117, В-3): what is left, what is over, or no plan. */
    function budgetWords(budget: MoneyMonthView['budget']): string | null {
      if (!budget) return null
      if (!budget.planned) return t('budget.entry.none')
      if (!budget.left) return null
      const amount = budgetAmount(budget.left, locale.value)
      return budget.left.minor < 0n
        ? t('budget.entry.over', { amount })
        : t('budget.entry.left', { amount })
    }

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
      accountsNow,
      newcomer,
      refusedHere,
      entries,
      saved,
      openSpendings,
    }
  },
})
</script>

<style scoped lang="scss">
/* The field is `AppScreen`'s 16 (С-23): a padding here made it 32. 24 between the groups — the
   accounts, the month with its strips, «Куда ушли», the ways out — and 8 inside one (Ф-10). */
.content {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: var(--space-6);
}

.month {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* «Куда ушли» while the month is coming: its card, the ring of 108 and three lines beside it. */
.ghost-donut {
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
  width: 30%;
}

.ghost-figure {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.ghost-ring {
  @include skeleton-bar;

  flex: none;
  width: 6.75rem;
  height: 6.75rem;
  border-radius: 50%;
  background: none;
  box-shadow: inset 0 0 0 1.08rem var(--border-strong);
}

.ghost-lines {
  display: grid;
  flex: 1;
  gap: var(--space-4);
}

.ghost-line:nth-child(2) {
  width: 72%;
}

.ghost-line:nth-child(3) {
  width: 54%;
}

/* The answer comes in where the skeleton stood, faded only: the screen keeps it in one block of its
   own, which `AppScreen` does not see, and nothing under the thumb may move (review №5, MOL-138). */
.content > :not(.month),
.month > * {
  @include appear(0);
}
</style>
