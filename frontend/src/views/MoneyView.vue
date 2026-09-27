<template>
  <AppScreen :title="t('spending.title')">
    <template #subtitle>{{ t('spending.subtitle') }}</template>

    <div class="content" :class="{ roomy: phase === 'ready' }">
      <p v-if="phase === 'ready' && !online" class="strip">
        <IconCloudOff class="strip-icon" aria-hidden="true" />{{ t('spending.offline.strip') }}
      </p>
      <p v-else-if="phase === 'ready' && stale === 'error' && fetchedAt" class="strip">
        {{ t('spending.error_strip', { when: whenOf(fetchedAt) }) }}
      </p>

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

      <template v-if="phase !== 'idle'">
        <MonthSwitcher :month="selected" :current="currentMonth" @change="goMonth" />

        <ScreenSkeleton v-if="phase === 'loading'" :groups="[44, 70, 34, 60, 80, 48, 66]" />

        <ScreenState
          v-else-if="phase === 'error'"
          kind="error"
          :title="t('spending.load_error.title')"
          :body="t('spending.load_error.body')"
          @retry="retry"
        />

        <ScreenState
          v-else-if="phase === 'offline'"
          kind="offline"
          tone="warn"
          :title="t('spending.offline.title')"
          :body="t('spending.offline.body')"
        >
          <template v-if="canWrite" #action>
            <AppButton size="large" block @click="compose">
              {{ t('spending.empty.action') }}
            </AppButton>
          </template>
        </ScreenState>

        <ScreenState
          v-else-if="newcomer"
          kind="empty"
          tone="accent"
          :icon="IconWallet"
          :title="t('spending.empty.title')"
          :body="t('spending.empty.body')"
        >
          <template #action>
            <AppButton size="large" block @click="compose">
              {{ t('spending.empty.action') }}
            </AppButton>
            <AppButton variant="ghost" block @click="goTab('trip')">
              {{ t('spending.empty.trip') }}
            </AppButton>
            <!-- A newcomer may take a preset out of the choice before the first spending too
                 (review У-2). -->
            <RouterLink class="empty-link" :to="{ name: 'money-categories' }">
              {{ t('spending.categories_link') }}
            </RouterLink>
          </template>
        </ScreenState>

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

            <div class="tiles">
              <button type="button" class="tile income" @click="openIncomes">
                <span class="tile-label">
                  <span class="verb">{{ t('spending.income_open') }}</span>
                  {{ t('spending.income') }}<IconChevron class="tile-chevron" aria-hidden="true" />
                </span>
                <span class="tile-figure">{{ whole(month.income) }}</span>
                <span v-if="month.incomeUncounted.length > 0" class="tile-note">
                  {{ t('spending.income_uncounted', { amounts: list(month.incomeUncounted) }) }}
                </span>
              </button>
              <div class="tile">
                <span class="tile-label">{{ t('spending.rest') }}</span>
                <span
                  class="tile-figure"
                  :class="{ negative: month.rest && month.rest.minor < 0n }"
                >
                  {{ month.rest ? `≈ ${signed(month.rest)}` : '—' }}
                </span>
                <span v-if="!month.rest" class="tile-note">{{ t('spending.rest_unknown') }}</span>
              </div>
            </div>

            <p class="footnote rate">{{ rateLine }}</p>
          </AppCard>

          <MoneyEntries :rate="liveRate" />

          <CategoryBars v-if="month.byCategory.length > 0" :month="month" :name-of="nameOf" />
          <!-- The way to one's categories is there before anything is spent (review Т-7). -->
          <AppCard v-else list>
            <RouterLink class="categories-link" :to="{ name: 'money-categories' }">
              <IconShape class="link-icon" aria-hidden="true" />
              <span class="link-label">{{ t('spending.categories_link') }}</span>
              <IconChevron class="link-chevron" aria-hidden="true" />
            </RouterLink>
          </AppCard>

          <h2 class="group-caption">{{ t('spending.days_title') }}</h2>
          <p v-if="journal.length === 0" class="footnote">{{ t('spending.month_empty') }}</p>
          <section v-for="day in journal" :key="day.day" class="day">
            <h3 class="day-head">
              <span>{{ dayTitle(day.day) }}</span>
              <span v-if="day.total" class="day-total">
                {{ day.estimated ? `≈ ${whole(day.total)}` : whole(day.total) }}
              </span>
            </h3>
            <AppCard as="ul" list>
              <SpendingRow
                v-for="row in day.rows"
                :key="row.key"
                :row="row"
                :category="categoryOf(row)"
                :category-name="categoryNameOf(row)"
                :spend-currency="month.spendCurrency"
                :data-row="row.key"
                @open="openRow(row, day.day)"
              />
            </AppCard>
          </section>

          <div v-if="month.remaining > 0" ref="sentinel" class="more">
            <p class="footnote">
              {{
                t('spending.more', { n: month.remaining, range: rangeOf(month) }, month.remaining)
              }}
            </p>
            <AppButton v-if="more === 'failed'" variant="ghost" @click="loadMore">
              {{ t('spending.more_retry') }}
            </AppButton>
          </div>
        </template>
        <!-- The one way left into the exchanges and incomes once they left «Настройки»: a first
             exchange may come before a first spending, and a month that will not load must not
             close the way to the income that broke it (MOL-81; review Т-1, as MOL-66 argued). -->
        <MoneyEntries
          v-if="newcomer || phase === 'error' || phase === 'loading'"
          :rate="liveRate"
        />
      </template>
    </div>

    <!-- «Вернуть» stands whatever the screen became under it — the only spending removed makes a
         newcomer of the person (adversarial Г); «Трата» stands wherever there is something to
         write it into, a slow answer and a broken server included (review Т-6). -->
    <FloatingDock v-if="removed || tripRemoved || showsAdd" class="float">
      <UndoStrip
        v-if="removed"
        :key="removed.stamp"
        :text="t('spending.removed', removed)"
        :announcement="t('spending.removed_announced', removed)"
        :action="t('spending.restore')"
        @restore="restore"
        @expire="removed = null"
      />
      <!-- A trip opened from here and removed comes back here, with its «Вернуть» (MOL-76). -->
      <TripUndoStrip v-else-if="tripRemoved" class="undo" />
      <AppButton v-else-if="showsAdd" ref="addButton" size="large" class="add" @click="compose">
        <template #icon><IconPlus /></template>
        {{ t('spending.add') }}
      </AppButton>
    </FloatingDock>

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
      @removed="onRemoved"
    />
    <NewCategorySheet
      v-model:open="newCategoryOpen"
      :categories="categories"
      @created="made = $event"
    />
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import IconChevron from '~icons/mdi/chevron-right'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import IconPlus from '~icons/mdi/plus'
import IconShape from '~icons/mdi/shape-outline'
import IconWallet from '~icons/mdi/wallet-outline'
import {
  formatEstimate,
  lastDayOf,
  monthOf as monthOfDay,
  monthSchema,
  percentChange,
  previousMonth,
  yerevanDate,
} from '@molvia/model'
import type { Money, MoneyMonthView, SpendingCategoryView, WireCode } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppScreen from '@/components/AppScreen.vue'
import CategoryBars from '@/components/CategoryBars.vue'
import FloatingDock from '@/components/FloatingDock.vue'
import MoneyEntries from '@/components/MoneyEntries.vue'
import MonthSwitcher from '@/components/MonthSwitcher.vue'
import NewCategorySheet from '@/components/NewCategorySheet.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SpendingRow from '@/components/SpendingRow.vue'
import SpendingSheet from '@/components/SpendingSheet.vue'
import TripUndoStrip from '@/components/TripUndoStrip.vue'
import UndoStrip from '@/components/UndoStrip.vue'
import { categoriesWith, journalOf, rateWords, unsentIn } from '@/components/spending'
import type { JournalRow, Removed, SpendingTarget } from '@/components/spending'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useMoneyMonth } from '@/composables/useMoneyMonth'
import { useReconnect } from '@/composables/useReconnect'
import { calendarDay, purchaseDay, shiftDay, timeOfDay } from '@/days'
import { useNavigation } from '@/navigation'
import { useActorStore } from '@/stores/actor'
import { spendingOf, useSpendingQueueStore } from '@/stores/spendingQueue'
import { useTripQueueStore } from '@/stores/tripQueue'

/**
 * «Деньги» (MOL-82, handoff 01): one month of one's own spending, counted by the server — what
 * was spent, what came in, where it went and the journal by day. The phone adds nothing up; what
 * waits in the queue is a row with its mark and a line on the card saying it is not counted yet
 * (Р-3). The month is in the address and moves by `replace`: looking at August is not a step the
 * system «back» should walk through.
 */
export default defineComponent({
  name: 'MoneyView',
  components: {
    AppButton,
    AppCard,
    AppScreen,
    CategoryBars,
    FloatingDock,
    IconChevron,
    IconCloudOff,
    IconPlus,
    IconShape,
    MoneyEntries,
    MonthSwitcher,
    NewCategorySheet,
    ScreenSkeleton,
    ScreenState,
    SpendingRow,
    SpendingSheet,
    TripUndoStrip,
    UndoStrip,
  },
  setup() {
    const { t, locale } = useI18n()
    const route = useRoute()
    const router = useRouter()
    const { goTab } = useNavigation()
    const actor = useActorStore()
    const queue = useSpendingQueueStore()
    const tripQueue = useTripQueueStore()
    const tripRemoved = computed(() => tripQueue.lastRemoved !== null)
    const announce = useAnnouncer()

    /**
     * This month in Yerevan, looked at again whenever the app comes back into view: an installed
     * app frozen over the last night of a month came back to the same page, and the new month was
     * «the future» — neither the address nor the arrow reached it (adversarial З, review Т-10).
     */
    const currentMonth = ref(monthOfDay(yerevanDate(new Date())))
    function lookAtToday(): void {
      currentMonth.value = monthOfDay(yerevanDate(new Date()))
    }
    useReconnect(lookAtToday)
    const selected = computed(() => {
      const asked = route.query.month
      return typeof asked === 'string' &&
        monthSchema.safeParse(asked).success &&
        asked <= currentMonth.value
        ? asked
        : currentMonth.value
    })
    const { phase, month, stale, fetchedAt, more, loadMore, retry, knownCategories, todayRate } =
      useMoneyMonth(selected)

    function goMonth(next: string): void {
      void router.replace({
        query: { ...route.query, month: next === currentMonth.value ? undefined : next },
      })
    }

    const online = ref(navigator.onLine)
    const onLine = () => (online.value = true)
    const offLine = () => (online.value = false)
    onMounted(() => {
      window.addEventListener('online', onLine)
      window.addEventListener('offline', offLine)
    })
    onUnmounted(() => {
      window.removeEventListener('online', onLine)
      window.removeEventListener('offline', offLine)
    })

    // Any month the phone keeps names the categories — they are the owner's, not the month's — so
    // a spending can be written before this month's answer, or offline on the first of the month
    // (review Т-5).
    const categories = computed(() => categoriesWith(knownCategories.value, queue.pending))
    /** Whether a spending can be written here at all: a category is required, and known. */
    const canWrite = computed(() => categories.value.some((category) => !category.archived))
    const journal = computed(() =>
      month.value ? journalOf(month.value, queue.pending, queue.rejected, tripQueue.removing) : [],
    )
    const unsent = computed(() => (month.value ? unsentIn(month.value, queue.pending) : 0))
    const spendCurrency = computed(
      () => month.value?.spendCurrency ?? actor.settings?.spendCurrency ?? 'AMD',
    )
    /** «Мой курс на сегодня» for the sheet: only a running month's rate is today's. */
    const liveRate = computed(() => todayRate.value)

    /**
     * «Пусто» is somebody with nothing yet — no spending, no trip, no income (Р-6). The server
     * does not say so; the running month with nothing in it, nothing the month before and
     * nothing waiting is as near as its answer gets. An empty August after a full July is a
     * month, not a newcomer: «В этом месяце трат нет».
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

    const showsAdd = computed(
      () =>
        canWrite.value &&
        !newcomer.value &&
        (phase.value === 'ready' || phase.value === 'loading' || phase.value === 'error'),
    )

    const whole = (value: Money) => formatEstimate(value, locale.value)
    const signed = (value: Money) =>
      value.minor < 0n
        ? `−${formatEstimate({ ...value, minor: -value.minor }, locale.value)}`
        : formatEstimate(value, locale.value)
    const list = (values: readonly Money[]) => values.map(whole).join(', ')

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

    function nameOf(category: SpendingCategoryView): string {
      return category.preset ? t(`spending.category.${category.preset}`) : (category.name ?? '')
    }
    const groceries = computed(
      () => categories.value.find((category) => category.preset === 'groceries') ?? null,
    )
    function categoryOf(row: JournalRow): SpendingCategoryView | null {
      if (row.kind === 'trip') return groceries.value
      return categories.value.find((category) => category.id === row.spending.categoryId) ?? null
    }
    function categoryNameOf(row: JournalRow): string {
      const category = categoryOf(row)
      return category ? nameOf(category) : t('spending.category.other')
    }

    /** Days of Yerevan's calendar, printed as such whatever the zone of the phone (review Т-1). */
    function dayTitle(day: string): string {
      const today = yerevanDate(new Date())
      const date = calendarDay(day, locale.value)
      if (day === today) return t('spending.day_today', { date })
      if (day === shiftDay(today, -1)) return t('spending.day_yesterday', { date })
      const text = calendarDay(day, locale.value, {
        weekday: 'short',
        day: 'numeric',
        month: 'long',
      })
      return text.charAt(0).toLocaleUpperCase(locale.value) + text.slice(1)
    }

    function rangeOf(value: MoneyMonthView): string {
      const { remainingFrom: from, remainingTo: to } = value
      if (!from || !to) return ''
      const last = calendarDay(to, locale.value)
      if (from === to) return last
      return `${String(Number(from.slice(8)))}–${last}`
    }

    const whenOf = (at: Date) => `${purchaseDay(at, locale.value)}, ${timeOfDay(at, locale.value)}`

    /** Refusals no row of this month carries — «Вернуть» too late, a category — said above. */
    const otherRefusals = computed(() =>
      queue.rejected.filter(
        (item) =>
          !['record', 'amend'].includes(item.write.kind) ||
          !journal.value.some((day) =>
            day.rows.some((row) => row.kind === 'manual' && row.key === spendingOf(item.write)),
          ),
      ),
    )
    const reasonOf = (code: WireCode) =>
      code.startsWith('error.') ? t(code) : t('spending.rejected_other.unknown', { code })

    // The next page as the end of the journal comes into view: no «Показать ещё» (handoff 01).
    const sentinel = ref<HTMLElement | null>(null)
    let observer: IntersectionObserver | null = null
    watch(sentinel, (element) => {
      observer?.disconnect()
      if (!element || typeof IntersectionObserver === 'undefined') return
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting) && more.value === 'idle') void loadMore()
      })
      observer.observe(element)
    })
    onUnmounted(() => observer?.disconnect())

    const sheetOpen = ref(false)
    const newCategoryOpen = ref(false)
    const made = ref<string | null>(null)
    const target = ref<SpendingTarget>({ kind: 'add' })

    function compose(): void {
      lookAtToday()
      toShow.value = null
      made.value = null
      target.value = { kind: 'add' }
      sheetOpen.value = true
    }

    function openRow(row: JournalRow, day: string): void {
      toShow.value = null
      made.value = null
      target.value = row.kind === 'trip' ? { kind: 'trip', row, day } : { kind: 'manual', row }
      sheetOpen.value = true
    }

    /** The spending just saved, until its row is on screen and brought into view (review С-2). */
    const toShow = ref<string | null>(null)

    function saved({ id, spentOn }: { id: string; spentOn: string }): void {
      lookAtToday()
      if (!online.value) announce?.(t('spending.saved_offline'))
      const into = monthOfDay(spentOn)
      if (into !== selected.value) goMonth(into)
      toShow.value = id
    }

    // The row comes with the queue at once, or with the month read again after the server took it,
    // or not at all on a page not loaded yet — then nothing is scrolled.
    watch(
      [toShow, journal],
      async ([id]) => {
        if (!id) return
        await nextTick()
        const row = document.querySelector(`[data-row="${id}"]`)
        if (!row) return
        toShow.value = null
        const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        row.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' })
      },
      { flush: 'post' },
    )

    const removed = ref<(Removed & { stamp: number }) | null>(null)
    const addButton = ref<ComponentPublicInstance | null>(null)

    function onRemoved(value: Removed): void {
      removed.value = { ...value, stamp: Date.now() }
    }

    async function restore(): Promise<void> {
      const value = removed.value
      if (!value) return
      queue.restore(value.undo)
      removed.value = null
      announce?.(t('spending.restored'))
      await nextTick()
      ;(addButton.value?.$el as HTMLElement | undefined)?.focus()
    }

    function openIncomes(): void {
      void router.push({ name: 'incomes' })
    }

    return {
      t,
      IconWallet,
      queue,
      goTab,
      phase,
      month,
      stale,
      fetchedAt,
      more,
      loadMore,
      retry,
      selected,
      currentMonth,
      goMonth,
      online,
      categories,
      journal,
      tripRemoved,
      unsent,
      spendCurrency,
      liveRate,
      newcomer,
      canWrite,
      showsAdd,
      whole,
      signed,
      list,
      change,
      foreign,
      rateLine,
      nameOf,
      categoryOf,
      categoryNameOf,
      dayTitle,
      rangeOf,
      whenOf,
      otherRefusals,
      reasonOf,
      sentinel,
      sheetOpen,
      newCategoryOpen,
      made,
      target,
      compose,
      openRow,
      saved,
      removed,
      addButton,
      onRemoved,
      restore,
      openIncomes,
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

  /* Room for «Трата» under the last rows: it floats over the journal, not in the dock (handoff 01). */
  &.roomy {
    padding-bottom: calc(var(--space-8) + var(--space-8) + var(--space-6));
  }
}

.strip {
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

.caption,
.group-caption {
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.group-caption {
  margin: 0;
  padding: var(--space-3) var(--space-1) 0;
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
  border: 0;
  border-radius: var(--radius);
  background: var(--surface-2);
  color: inherit;
  font: inherit;
  text-align: left;
}

.income {
  cursor: pointer;

  &:focus-visible {
    @include focus-ring;
  }
}

.verb {
  @include visually-hidden;
}

.tile-label {
  display: flex;
  align-items: center;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.tile-chevron {
  width: 1.125rem;
  height: 1.125rem;
  margin-left: auto;
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

.day {
  display: grid;
  gap: var(--space-2);
}

.day-head {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  margin: 0;
  padding: var(--space-1) var(--space-1) 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.day-total {
  font-weight: var(--weight-regular);
  font-variant-numeric: tabular-nums;
}

.more {
  display: grid;
  justify-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 0;
}

.add {
  box-shadow: var(--shadow-md);
}

.empty-link {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: var(--touch-target);
  color: var(--accent-ink);
  font-weight: var(--weight-medium);
  text-decoration: none;

  &:focus-visible {
    @include focus-ring;
  }
}

.categories-link {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--touch-target-lg);
  padding: 0 var(--space-4);
  color: var(--text);
  text-decoration: none;

  &:focus-visible {
    @include focus-ring(-2px);
  }
}

.link-icon {
  width: 1.375rem;
  height: 1.375rem;
  color: var(--text-muted);
}

.link-label {
  flex: 1;
}

.link-chevron {
  width: 1.25rem;
  height: 1.25rem;
  color: var(--text-muted);
}

.float > .undo {
  flex: 1;
}
</style>
