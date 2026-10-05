<template>
  <AppScreen :title="t('spending.list.title')">
    <div class="content">
      <template v-if="phase !== 'idle'">
        <MonthSwitcher :month="selected" :current="currentMonth" @change="goMonth" />

        <!-- Under the switcher, as on «Деньгах»: they come and go with the answer (MOL-138). -->
        <p v-if="phase === 'ready' && !online && fetchedAt" class="strip">
          <IconCloudOff class="strip-icon" aria-hidden="true" />
          {{ t('spending.list.offline_strip', { when: whenOf(fetchedAt) }) }}
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

        <!-- Every spending the server refused, of any month, whatever the month shown and its pages:
             opened, it is what was typed — to fix and save again, or to drop (MOL-159). -->
        <AppReveal>
          <section v-if="refusals.length > 0" class="day">
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

        <ScreenSkeleton v-if="phase === 'loading'" :groups="[46, 64, 38, 52, 30, 60, 44]" />

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
        />

        <!-- No button inside: «Добавить трату» is the strip under the thumb (handoff 02, 2d). -->
        <ScreenState
          v-else-if="month && journal.length === 0"
          kind="empty"
          tone="accent"
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
            </span>
          </div>

          <!-- Another month is another answer, not days come and gone: it is just there (MOL-136,
               MOL-151 adversarial А1). -->
          <AppReveal :key="month.month" group>
            <section v-for="day in journal" :key="day.day" class="day">
              <h2 class="day-head">
                <span>{{ dayTitle(day.day) }}</span>
                <span v-if="day.total" class="day-total">
                  {{ day.estimated ? `≈\u00a0${whole(day.total)}` : whole(day.total) }}
                </span>
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
      <!-- A trip opened from here and removed comes back here, with its «Вернуть» (MOL-76). -->
      <TripUndoStrip v-else class="undo" />
    </FloatingDock>

    <template v-if="canWrite && phase !== 'idle'" #docked>
      <div class="add">
        <AppButton ref="addButton" size="large" block @click="add">
          <template #icon><IconPlus /></template>
          {{ t('spending.summary.add') }}
        </AppButton>
      </div>
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
      @removed="onRemoved"
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
import { computed, defineComponent, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import IconPlus from '~icons/mdi/plus'
import IconWallet from '~icons/mdi/wallet-outline'
import { formatEstimate, monthOf as monthOfDay } from '@molvia/model'
import type { Currency, Money, MoneyMonthView, SpendingCategoryView } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppReveal from '@/components/AppReveal.vue'
import AppScreen from '@/components/AppScreen.vue'
import FloatingDock from '@/components/FloatingDock.vue'
import MonthSwitcher from '@/components/MonthSwitcher.vue'
import NewCategorySheet from '@/components/NewCategorySheet.vue'
import OperationRow from '@/components/OperationRow.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SpendingSheet from '@/components/SpendingSheet.vue'
import TripUndoStrip from '@/components/TripUndoStrip.vue'
import UndoStrip from '@/components/UndoStrip.vue'
import { journalRowProps } from '@/components/spending'
import type { JournalRow, OperationRowProps } from '@/components/spending'
import { useMoneyScreen } from '@/composables/useMoneyScreen'
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
    FloatingDock,
    IconCloudOff,
    IconPlus,
    MonthSwitcher,
    NewCategorySheet,
    OperationRow,
    ScreenSkeleton,
    ScreenState,
    SpendingSheet,
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
      return [
        value.spentIncome ? `≈ ${whole(value.spentIncome)}` : null,
        unsent > 0 ? t('spending.list.unsent', { n: unsent }, unsent) : null,
      ]
        .filter((part) => part !== null)
        .join(' · ')
    })

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
      screen.openRow(row, day)
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
      ...screen,
      addButton,
      t,
      IconWallet,
      month,
      whole,
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
/* The dock keeps no padding of its own above or below: the screen's row does (as «Покупки»). */
.add {
  padding: var(--space-3) 0;
}

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
  @include icon;

  font-size: var(--icon-sm);
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

.more {
  display: grid;
  justify-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 0;
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
