<template>
  <AppScreen :title="t('spending.list.title')">
    <div class="content">
      <template v-if="phase !== 'idle'">
        <MonthSwitcher :month="selected" :current="currentMonth" @change="goMonth" />

        <!-- Under the switcher, as on «Деньгах»: they come and go with the answer (MOL-138). -->
        <StatusStrip
          v-if="phase === 'ready' && !online && fetchedAt"
          kind="offline"
          :text="t('spending.list.offline_strip', { when: whenOf(fetchedAt) })"
        />
        <StatusStrip
          v-else-if="phase === 'ready' && stale === 'error' && fetchedAt"
          kind="unanswered"
          :text="t('spending.error_strip', { when: whenOf(fetchedAt) })"
          :attempt="attempt"
        >
          <!-- The strip holds «Добавить трату», so «Повторить» is here (К-5, MOL-181). -->
          <template #action>
            <AppButton variant="ghost" @click="retry">{{ t('state.retry') }}</AppButton>
          </template>
        </StatusStrip>
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

        <!-- Every spending the server refused, of any month, whatever the month shown and its pages:
             opened, it is what was typed — to fix and save again, or to drop (MOL-159). -->
        <AppReveal>
          <section v-if="refusals.length > 0" class="day refused">
            <h2 class="day-head">{{ t('spending.list.refused') }}</h2>
            <AppCard v-if="refused.length > 0" as="ul" list>
              <AppReveal group>
                <OperationRow
                  v-for="row in refused"
                  :key="row.key"
                  v-bind="rowOf(row, spendCurrency, dayTitle(row.spending.spentOn))"
                  :data-row="row.key"
                  @open="open(row, row.spending.spentOn)"
                />
              </AppReveal>
            </AppCard>
            <!-- The rest are marked on their own rows below: named here, and led to (round 7, Р). -->
            <AppButton
              v-if="refusedInJournal.length > 0"
              variant="ghost"
              class="to-marked"
              @click="toMarked"
            >
              {{
                t(
                  refused.length > 0 ? 'spending.list.refused_more' : 'spending.list.refused_below',
                  { n: refusedInJournal.length },
                  refusedInJournal.length,
                )
              }}
            </AppButton>
          </section>
        </AppReveal>

        <!-- The answer's shape (MOL-178, 2g): the total on the ground, as it stands — 2g drew it a
             card — then a day's caption and its rows. -->
        <ScreenSkeleton v-if="phase === 'loading'">
          <span class="total">
            <span class="count">
              <span class="ghost-line"><span class="ghost-bar ghost-count"></span></span>
            </span>
            <span class="sum">
              <span class="figure">
                <span class="ghost-line"><span class="ghost-bar ghost-figure"></span></span>
              </span>
              <span v-if="twoCurrencies" class="approx">
                <span class="ghost-line"><span class="ghost-bar ghost-approx"></span></span>
              </span>
            </span>
          </span>
          <SkeletonPart kind="caption" :width="46" />
          <SkeletonPart kind="rows" :count="3" lead="circle" meta tail next />
        </ScreenSkeleton>

        <!-- A section's error, not the screen's: «Добавить трату» keeps the strip, since a spending
             goes through the queue with the server down (157 v2, 1k/2e; MOL-180, В-1). -->
        <ScreenState
          v-else-if="phase === 'error'"
          kind="error"
          inline
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
        />

        <!-- No button inside: «Добавить трату» is the strip under the thumb (handoff 02, 2d). -->
        <ScreenState
          v-else-if="month && journal.length === 0"
          kind="empty"
          :icon="IconWallet"
          :title="t('spending.list.empty.title', { month: monthIn(month.month) })"
          :body="t('spending.list.empty.body')"
        />

        <template v-else-if="month">
          <!-- The month's count and sum are the server's; what waits on the phone is said apart. -->
          <div class="total">
            <span v-if="month.count !== null" class="count">
              {{ t('spending.list.count', { n: month.count }, month.count) }}
            </span>
            <span class="sum">
              <span class="figure">{{ whole(month.spent) }}</span>
              <span v-if="approx" class="approx">{{ approx }}</span>
              <!-- The month's figure says what it leaves out, as on «Деньгах» (MOL-184, В-2). -->
              <span v-if="month.uncounted.length > 0" class="approx">
                {{ t('spending.uncounted', { amounts: uncountedOf(month) }) }}
              </span>
            </span>
          </div>

          <!-- Another month is another answer, not days come and gone: it is just there (MOL-136,
               MOL-151 adversarial А1). -->
          <div class="days">
            <AppReveal :key="month.month" group>
              <section v-for="day in journal" :key="day.day" class="day">
                <h2 class="day-head">
                  <span>{{ dayTitle(day.day) }}</span>
                  <span v-if="day.total" class="day-total">{{ dayTotalText(day, locale) }}</span>
                </h2>
                <AppCard as="ul" list>
                  <AppReveal group>
                    <OperationRow
                      v-for="row in day.rows"
                      :key="row.key"
                      v-bind="rowOf(row, month.spendCurrency)"
                      :data-row="row.key"
                      @open="open(row, day.day)"
                    />
                  </AppReveal>
                </AppCard>
              </section>
            </AppReveal>
          </div>

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
      </template>
    </div>

    <!-- «Вернуть» stands whatever the screen became under it (adversarial Г), over the strip. -->
    <template v-if="removed || tripRemoved || transferRemoved" #undo>
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
      <!-- A transfer removed from its fee's row comes back here, with the fee (MOL-253). -->
      <UndoStrip
        v-else-if="transferRemoved"
        :key="transferRemoved.stamp"
        :text="t('transfer.removed')"
        :announcement="t('transfer.removed_announced')"
        :action="t('spending.restore')"
        @restore="restoreTransfer"
        @expire="transferRemoved = null"
      />
      <!-- A trip opened from here and removed comes back here, with its «Вернуть» (MOL-76). -->
      <TripUndoStrip v-else />
    </template>

    <template v-if="canWrite && phase !== 'idle'" #docked>
      <AppButton ref="addButton" size="large" block @click="add">
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
      @removed="spendingRemoved"
    />
    <NewCategorySheet
      v-model:open="newCategoryOpen"
      over
      :categories="categories"
      @created="made = $event"
    />
    <!-- A transfer's fee opens its transfer: the two are amended together (MOL-253, Р-5). -->
    <TransferSheet
      v-model:open="transferOpen"
      :editing-id="transferId"
      :online="online"
      :spend-currency="spendCurrency"
      @done="transferEnded"
    />
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconPlus from '~icons/mdi/plus'
import IconWallet from '~icons/mdi/wallet-outline'
import { formatEstimate, monthOf as monthOfDay } from '@molvia/model'
import type { Currency, Money, MoneyMonthView, SpendingCategoryView } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppReveal from '@/components/AppReveal.vue'
import AppScreen from '@/components/AppScreen.vue'
import MonthSwitcher from '@/components/MonthSwitcher.vue'
import NewCategorySheet from '@/components/NewCategorySheet.vue'
import OperationRow from '@/components/OperationRow.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SkeletonPart from '@/components/SkeletonPart.vue'
import SpendingSheet from '@/components/SpendingSheet.vue'
import StatusStrip from '@/components/StatusStrip.vue'
import TransferSheet from '@/components/TransferSheet.vue'
import type { TransferOutcome } from '@/components/TransferSheet.vue'
import type { Removed } from '@/components/spending'
import TripUndoStrip from '@/components/TripUndoStrip.vue'
import UndoStrip from '@/components/UndoStrip.vue'
import { asTyped, dayTotalText, journalRowProps, spentApprox } from '@/components/spending'
import type { JournalRow, OperationRowProps } from '@/components/spending'
import { useMoneyScreen } from '@/composables/useMoneyScreen'
import { useTransferOutcome } from '@/composables/useTransferOutcome'
import { calendarDay, shiftDay } from '@/days'

/**
 * «Траты» (MOL-159, handoff MOL-157 02): the journal of the month «Деньги» shows, moved here whole —
 * by day, a page at a time, what waits on the phone a row marked «Отправляем…», never a figure. The
 * month is the address's, the same one «Деньги» had open; the count and the sum are the server's.
 */
export default defineComponent({
  name: 'MoneySpendingsView',
  components: {
    AppButton,
    AppCard,
    AppReveal,
    AppScreen,
    IconPlus,
    MonthSwitcher,
    NewCategorySheet,
    OperationRow,
    ScreenSkeleton,
    ScreenState,
    SkeletonPart,
    SpendingSheet,
    StatusStrip,
    TransferSheet,
    TripUndoStrip,
    UndoStrip,
  },
  setup() {
    const { t, locale } = useI18n()
    const screen = useMoneyScreen()
    // «Добавить трату», where the focus goes once «Вернуть» has done its work.
    const { addButton } = screen
    const { categories, today, month, more, loadMore } = screen

    const whole = (value: Money) => formatEstimate(value, locale.value)
    /**
     * «≈ 52 000 ₽ · 1 ещё не учтена»: either part may be missing — no rate, nothing waiting — and the
     * dot stands only between two (adversarial Б of MOL-159: two templates in the markup lost the
     * space before it, and with no «≈» the line began with it).
     */
    const approx = computed(() => {
      const value = month.value
      if (!value) return ''
      const unsent = screen.unsent.value
      const inIncome = spentApprox(value)
      return [
        inIncome ? `≈ ${whole(inIncome)}` : null,
        unsent > 0 ? t('spending.list.unsent', { n: unsent }, unsent) : null,
      ]
        .filter((part) => part !== null)
        .join(' · ')
    })

    /** What no rate counted, as written: no «≈» stands before it (adversarial А2). */
    const uncountedOf = (value: MoneyMonthView) =>
      value.uncounted.map((amount) => asTyped(amount, locale.value)).join(', ')

    const groceries = computed(
      () => categories.value.find((category) => category.preset === 'groceries') ?? null,
    )
    function categoryOf(row: JournalRow): SpendingCategoryView | null {
      if (row.kind === 'trip') return groceries.value
      return categories.value.find((category) => category.id === row.spending.categoryId) ?? null
    }
    function categoryNameOf(row: JournalRow): string {
      const category = categoryOf(row)
      return category ? screen.nameOf(category) : t('spending.category.other')
    }
    /** `when` — the day, where rows of different days stand together: «Не приняты». */
    function rowOf(row: JournalRow, spendCurrency: Currency, when = ''): OperationRowProps {
      return journalRowProps(row, {
        t,
        locale: locale.value,
        category: categoryOf(row),
        categoryName: categoryNameOf(row),
        spendCurrency,
        when,
      })
    }

    /**
     * Days of the calendar, printed as such whatever the zone of the phone (review Т-1); «Сегодня»
     * is the phone's today (MOL-121).
     */
    function dayTitle(day: string): string {
      const date = calendarDay(day, locale.value)
      if (day === today.value) return t('spending.day_today', { date })
      if (day === shiftDay(today.value, -1)) return t('spending.day_yesterday', { date })
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

    // The next page as the end of the journal comes into view: no «Показать ещё» (handoff 02).
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

    /** The spending just saved, until its row is on screen and brought into view (review С-2). */
    const toShow = ref<string | null>(null)

    /** The first refusal marked in the journal, brought into view and given the focus. */
    function toMarked(): void {
      const key = screen.refusedInJournal.value[0]
      const row = key
        ? document.querySelector<HTMLElement>(`.day [data-row="${key}"] .list-row`)
        : null
      if (!row) return
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      row.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' })
      row.focus({ preventScroll: true })
    }

    function add(): void {
      toShow.value = null
      screen.compose()
    }
    function open(row: JournalRow, day: string): void {
      toShow.value = null
      const of = row.kind === 'manual' ? row.spending.transferId : null
      if (of !== null) {
        transferId.value = of
        transferOpen.value = true
        return
      }
      screen.openRow(row, day)
    }
    const transferOpen = ref(false)
    const transferId = ref<string | null>(null)
    const {
      removed: transferRemoved,
      done: transferDone,
      restore: restoreTransfer,
    } = useTransferOutcome()
    // One «Вернуть» at a time: the newer removal's strip takes the place of the older (review С-6).
    function transferEnded(outcome: TransferOutcome): void {
      if (outcome.kind === 'removed') screen.forgetRemoved()
      transferDone(outcome)
    }
    function spendingRemoved(value: Removed): void {
      transferRemoved.value = null
      screen.onRemoved(value)
    }

    /** A spending of another month takes «Траты» to its month, and its row into view (handoff 06). */
    function saved({ id, spentOn }: { id: string; spentOn: string }): void {
      screen.lookAtToday()
      if (!screen.online.value) screen.announce?.(t('spending.saved_offline'))
      const into = monthOfDay(spentOn)
      if (into !== screen.selected.value) screen.goMonth(into)
      toShow.value = id
    }

    // The row comes with the queue at once, or with the month read again after the server took it,
    // or not at all on a page not loaded yet — then nothing is scrolled.
    watch(
      [toShow, screen.journal],
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

    return {
      transferOpen,
      transferId,
      transferRemoved,
      transferEnded,
      spendingRemoved,
      restoreTransfer,
      ...screen,
      addButton,
      t,
      locale,
      IconWallet,
      month,
      whole,
      dayTotalText,
      uncountedOf,
      approx,
      rowOf,
      dayTitle,
      rangeOf,
      sentinel,
      add,
      toMarked,
      open,
      saved,
    }
  },
})
</script>

<style scoped lang="scss">
.content {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: var(--space-2);
}

/* 24 between the days and above the first (157 v2 02 п. 4, Ф-10); 8 from a day's words to its card.
   The field is `AppScreen`'s 16 (С-23): a padding here made it 32. A flex column, not a grid: a day
   removed takes the column's gap with it (`AppReveal`, А2). «Не приняты» is a group of its own, 24 on
   both sides. */
.days {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  margin-top: var(--space-4);
}

.refused {
  margin-block: var(--space-4);
}

.total {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-1) var(--space-1) 0;
}

.count {
  padding-top: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-callout);
}

.sum {
  display: grid;
  justify-items: end;
  margin-left: auto;
  text-align: right;
}

.figure {
  @include display-type;

  font-size: var(--text-title);
  font-variant-numeric: tabular-nums;
}

.approx {
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-variant-numeric: tabular-nums;
}

.footnote {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.day {
  display: grid;
  gap: var(--space-2);
}

/* The day's sum stands over the rows' sums (157 v2 02 п. 4, MOL-176 В-1). */
.day-head {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  margin: 0;
  padding: var(--space-1) var(--space-tail) 0 var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.to-marked {
  justify-self: start;
}

/* The day's words give way on a narrow phone, never its sum: broken, «≈» stood over «125 403 ֏» and the
   figure left the column (review Р3-1). */
.day-total {
  flex: none;
  font-weight: var(--weight-regular);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* The total while the month is coming: its own lines, at the answer's sizes and leading, so the
   days come in where the caption and the rows stood (MOL-178). */
.ghost-line {
  display: flex;
  align-items: center;
  height: calc(1em * var(--leading-body));
}

.ghost-bar {
  @include skeleton-bar;

  height: var(--skeleton-caption);
}

.ghost-count {
  width: 4.5rem;
}

.ghost-figure {
  width: 8rem;
  height: var(--skeleton-figure);
}

.ghost-approx {
  width: 5rem;
}

.more {
  display: grid;
  justify-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 0;
}

/* The answer comes in where the skeleton stood, faded only: the screen keeps it in one block of its
   own, which `AppScreen` does not see, and nothing under the thumb may move (review №5, MOL-138). */
.content > * {
  @include appear(0);
}
</style>
