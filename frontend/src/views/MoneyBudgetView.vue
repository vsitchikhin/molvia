<template>
  <AppScreen :title="t('budget.title')">
    <div class="content">
      <MonthSwitcher :month="month" :current="currentMonth" @change="chooseMonth" />

      <!-- Under the switcher: they belong to the month's answer (MOL-138, owner's В-2). -->
      <p v-if="stale === 'offline' && fetchedAt" class="strip">
        <IconCloudOff class="strip-icon" aria-hidden="true" />
        {{ t('budget.offline_strip', { when: when(fetchedAt) }) }}
      </p>
      <ScreenState
        v-else-if="stale === 'error'"
        kind="error"
        inline
        :title="t('budget.load_error.title')"
        :body="t('budget.load_error.body')"
        @retry="retry"
      />

      <ScreenSkeleton v-if="phase === 'loading'" :groups="[64, 100, 72, 72, 72, 48, 60]" />

      <ScreenState
        v-else-if="phase === 'error'"
        kind="error"
        :title="t('budget.load_error.title')"
        :body="t('budget.load_error.body')"
        @retry="retry"
      />

      <ScreenState
        v-else-if="phase === 'offline'"
        kind="offline"
        tone="warn"
        :title="t('spending.offline.title')"
        :body="t('budget.offline_body')"
      />

      <template v-else-if="budget">
        <!-- The savings target alone is a plan too (adversarial Д): no «Плана пока нет» over it. -->
        <ScreenState
          v-if="!budget.total && budget.savings.target === null"
          kind="empty"
          tone="accent"
          :icon="IconTarget"
          :title="t('budget.empty.title')"
          :body="t('budget.empty.body')"
        />
        <AppCard v-else-if="budget.total" class="total">
          <p class="caption">
            {{ overall.over ? t('budget.total.over') : t('budget.total.left') }}
          </p>
          <p class="figure" :class="{ over: overall.over }">{{ overall.figure }}</p>
          <p v-if="budget.total.leftIncome" class="approx">
            ≈ {{ amount(budget.total.leftIncome) }}
          </p>
          <p v-if="awaiting" class="footnote">{{ t('budget.total.awaiting') }}</p>
          <p v-else-if="!budget.total.whole" class="footnote">{{ t('budget.total.not_whole') }}</p>
          <dl class="trio">
            <div>
              <dt>{{ t('budget.total.planned') }}</dt>
              <dd>{{ whole(budget.total.planned) }}</dd>
            </div>
            <div>
              <dt>{{ t('spending.spent') }}</dt>
              <dd>{{ whole(budget.total.spent) }}</dd>
            </div>
            <div>
              <dt>{{ t('budget.total.unplanned') }}</dt>
              <dd>{{ whole(budget.total.unplanned) }}</dd>
            </div>
          </dl>
        </AppCard>

        <AppCard v-if="budget.rows.length > 0" as="ul" list>
          <li v-for="row in rows" :key="row.categoryId">
            <button type="button" class="row" @click="edit(row.categoryId, row.plan)">
              <span class="head">
                <span class="dot" :style="{ background: row.colour }" aria-hidden="true"></span>
                <span class="name">{{ row.name }}</span>
                <span class="left" :class="{ over: row.over }">{{ row.left }}</span>
              </span>
              <span class="track" aria-hidden="true">
                <span class="fill" :class="{ over: row.over }" :style="{ width: row.width }"></span>
              </span>
              <span class="meta">
                <span>{{ row.of }}</span>
                <span :class="{ over: row.over }">{{ row.used }}</span>
              </span>
            </button>
          </li>
        </AppCard>

        <template v-if="unplanned.length > 0">
          <h2 class="group">{{ t('budget.unplanned') }}</h2>
          <AppCard as="ul" list>
            <li v-for="row in unplanned" :key="row.categoryId">
              <!-- A removed category is no choice (review 7): its spending is shown, a plan is not offered. -->
              <div v-if="row.archived" class="row still">
                <span class="head">
                  <span class="dot" :style="{ background: row.colour }" aria-hidden="true"></span>
                  <span class="name">{{ row.name }}</span>
                  <span class="left">{{ row.spent }}</span>
                </span>
              </div>
              <button v-else type="button" class="row" @click="edit(row.categoryId, null)">
                <span class="head">
                  <span class="dot" :style="{ background: row.colour }" aria-hidden="true"></span>
                  <span class="name">{{ row.name }}</span>
                  <span class="left">{{ row.spent }}</span>
                </span>
              </button>
            </li>
          </AppCard>
        </template>

        <AppButton v-if="choosable.length > 0" variant="secondary" block @click="choose">
          <template #icon><IconPlus /></template>
          {{ t('budget.add') }}
        </AppButton>

        <AppCard as="section" list :aria-labelledby="`${id}-savings`">
          <button type="button" class="row" @click="editSavings">
            <span class="head">
              <span :id="`${id}-savings`" class="name">{{ t('budget.savings.title') }}</span>
              <span class="left">{{ savings.actual }}</span>
            </span>
            <span v-if="savings.width !== null" class="track" aria-hidden="true">
              <span class="fill" :style="{ width: savings.width }"></span>
              <span v-if="savings.target" class="mark" :style="{ left: savings.target }"></span>
            </span>
            <span class="meta">
              <span>{{ savings.goal }}</span>
              <span>{{ savings.of }}</span>
            </span>
          </button>
        </AppCard>
      </template>
    </div>

    <BudgetPlanSheet
      v-model:open="sheetOpen"
      :month="month"
      :subject="subject"
      :plan="plan"
      :categories="choosable"
      :name-of="nameOf"
      :spend-currency="budget?.spendCurrency ?? 'AMD'"
      :online="online"
      @done="done"
    />
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import IconPlus from '~icons/mdi/plus'
import IconTarget from '~icons/mdi/target'
import { formatEstimate, monthSchema } from '@molvia/model'
import type { BudgetPlanValue, Money, SpendingCategoryView } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppScreen from '@/components/AppScreen.vue'
import BudgetPlanSheet from '@/components/BudgetPlanSheet.vue'
import type { BudgetOutcome, BudgetSubject } from '@/components/BudgetPlanSheet.vue'
import MonthSwitcher from '@/components/MonthSwitcher.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import { countedWhen } from '@/components/accounts'
import { budgetAmount, categoryColour } from '@/components/spending'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useLocalDay } from '@/composables/useLocalDay'
import { useMoneyBudget } from '@/composables/useMoneyBudget'

/**
 * «Бюджет» (MOL-117, В-3): the month's plans against what was spent — every figure the server's,
 * the phone adds nothing up. The rows stand in the order of the chips, never by alarm; a row over
 * its plan says so in the colour of a warning, never red (Р-7). A tap opens the plan of the row from
 * this month on (В-1). The month is in the address and moves by `replace`, as on «Деньгах».
 */
export default defineComponent({
  name: 'MoneyBudgetView',
  components: {
    AppButton,
    AppCard,
    AppScreen,
    BudgetPlanSheet,
    IconCloudOff,
    IconPlus,
    MonthSwitcher,
    ScreenSkeleton,
    ScreenState,
  },
  setup() {
    const { t, locale } = useI18n()
    const route = useRoute()
    const router = useRouter()
    const today = useLocalDay()
    const announce = useAnnouncer()
    const id = useId()

    const currentMonth = computed(() => today.value.slice(0, 7))
    /** A month the address names, else this one; one still to come or not a month is this one too. */
    const month = computed(() => {
      const asked = route.query.month
      return typeof asked === 'string' &&
        monthSchema.safeParse(asked).success &&
        asked <= currentMonth.value
        ? asked
        : currentMonth.value
    })
    function chooseMonth(value: string): void {
      void router.replace({
        query: { ...route.query, month: value === currentMonth.value ? undefined : value },
      })
    }

    const { phase, budget, stale, fetchedAt, retry, accept } = useMoneyBudget(month)

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

    const categories = computed(() => budget.value?.categories ?? [])
    const categoryOf = (categoryId: string): SpendingCategoryView | undefined =>
      categories.value.find((category) => category.id === categoryId)
    function nameOf(categoryId: string): string {
      const category = categoryOf(categoryId)
      if (!category) return ''
      return category.preset ? t(`spending.category.${category.preset}`) : (category.name ?? '')
    }
    const colourOf = (categoryId: string) => {
      const category = categoryOf(categoryId)
      return category ? categoryColour(category) : 'var(--text-muted)'
    }

    const whole = (value: Money) => formatEstimate(value, locale.value)
    /** A figure without its sign — the words around it say which way (Р-7, adversarial Г). */
    const amount = (value: Money) => budgetAmount(value, locale.value)
    const percent = (value: number) =>
      new Intl.NumberFormat(locale.value, { style: 'percent' }).format(value / 100)
    const when = (at: Date) => countedWhen(at, locale.value)

    const overall = computed(() => {
      const left = budget.value?.total?.left
      if (!left) return { over: false, figure: '' }
      return { over: left.minor < 0n, figure: amount(left) }
    })
    /** Some share waits for «Пришло»: the total says that, not «нет курса» (review 1). */
    const awaiting = computed(() => (budget.value?.rows ?? []).some((row) => row.awaitingIncome))

    const rows = computed(() =>
      (budget.value?.rows ?? []).map((row) => {
        const over = row.left !== null && row.left.minor < 0n
        // «≈» before a plan the server converted by the month's rate (review 2, adversarial Б, Р-4).
        const planned =
          row.planned === null ? '—' : `${row.estimated ? '≈ ' : ''}${whole(row.planned)}`
        const notes = [
          ...(row.plan.kind === 'share'
            ? [t('budget.row.share', { percent: row.plan.percent })]
            : []),
          ...(row.awaitingIncome ? [t('budget.row.awaiting')] : []),
          ...(!row.plannedWhole || !row.spentWhole
            ? [t('spending.charts.difference_uncounted')]
            : []),
        ]
        return {
          categoryId: row.categoryId,
          plan: row.plan,
          name: nameOf(row.categoryId),
          colour: colourOf(row.categoryId),
          over,
          // Over the plan is said by the words beside it, never by a minus (Р-7, review 5).
          left: row.left === null ? '—' : amount(row.left),
          of: [t('budget.row.of', { spent: whole(row.spent), planned }), ...notes].join(' · '),
          used: over ? t('budget.row.over') : row.used === null ? '' : percent(row.used),
          // The share is the server's; the phone only stops the bar at the card's edge.
          width: `${String(Math.min(row.used ?? (over ? 100 : 0), 100))}%`,
        }
      }),
    )

    const unplanned = computed(() =>
      (budget.value?.unplanned ?? []).map((row) => ({
        categoryId: row.categoryId,
        name: nameOf(row.categoryId),
        colour: colourOf(row.categoryId),
        archived: categoryOf(row.categoryId)?.archived === true,
        spent: row.spentWhole
          ? whole(row.spent)
          : `${whole(row.spent)} · ${t('spending.charts.difference_uncounted')}`,
      })),
    )

    /** Live categories with no row yet: the ones «Задать план» offers. */
    const choosable = computed(() => {
      const shown = new Set((budget.value?.rows ?? []).map((row) => row.categoryId))
      return categories.value.filter((category) => !category.archived && !shown.has(category.id))
    })

    const running = computed(() => month.value === currentMonth.value)
    const savings = computed(() => {
      const value = budget.value?.savings
      if (!value) return { actual: '', goal: '', of: '', width: null, target: null }
      const actual =
        value.actual === null
          ? '—'
          : running.value
            ? t('budget.savings.so_far', { percent: percent(value.actual) })
            : percent(value.actual)
      return {
        actual,
        goal:
          value.target === null
            ? t('budget.savings.no_target')
            : t('budget.savings.target', { percent: value.target }),
        of: value.difference
          ? t('budget.savings.of', {
              difference:
                value.difference.minor < 0n
                  ? `−${amount(value.difference)}`
                  : amount(value.difference),
              income: whole(value.income),
            })
          : value.income.minor === 0n
            ? t('budget.savings.no_income')
            : t('budget.savings.not_whole'),
        width:
          value.actual === null ? null : `${String(Math.max(0, Math.min(value.actual, 100)))}%`,
        target: value.target === null ? null : `${String(value.target)}%`,
      }
    })

    const sheetOpen = ref(false)
    const subject = ref<BudgetSubject>({ kind: 'choose' })
    const plan = ref<BudgetPlanValue | null>(null)
    function edit(categoryId: string, current: BudgetPlanValue | null): void {
      subject.value = { kind: 'category', categoryId }
      plan.value = current
      sheetOpen.value = true
    }
    function choose(): void {
      subject.value = { kind: 'choose' }
      plan.value = null
      sheetOpen.value = true
    }
    function editSavings(): void {
      subject.value = { kind: 'savings' }
      const target = budget.value?.savings.target
      plan.value = target == null ? null : { kind: 'share', percent: target }
      sheetOpen.value = true
    }
    /** The write's own answer is the month's budget now: shown, with no second read (review 6). */
    function done(outcome: BudgetOutcome): void {
      accept(outcome.budget.month, outcome.budget)
      announce?.(
        t(outcome.kind === 'saved' ? 'budget.saved' : 'budget.removed', { name: outcome.name }),
      )
    }

    return {
      t,
      id,
      IconTarget,
      month,
      currentMonth,
      chooseMonth,
      phase,
      budget,
      stale,
      fetchedAt,
      retry,
      online,
      whole,
      amount,
      when,
      overall,
      awaiting,
      rows,
      unplanned,
      choosable,
      savings,
      nameOf,
      sheetOpen,
      subject,
      plan,
      edit,
      choose,
      editSavings,
      done,
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

.total {
  display: grid;
  gap: var(--space-1);
}

.caption {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.figure {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-figure);
  font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;

  &.over {
    color: var(--warn-ink);
  }
}

.approx,
.footnote {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.trio {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
  margin: var(--space-3) 0 0;

  dt {
    color: var(--text-muted);
    font-size: var(--text-footnote);
  }

  dd {
    margin: 0;
    font-size: var(--text-callout);
    font-weight: var(--weight-medium);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
}

.group {
  margin: 0;
  padding: var(--space-3) var(--space-1) 0;
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

li + li {
  border-top: var(--hairline) solid var(--border);
}

.row {
  display: grid;
  gap: var(--space-2);
  width: 100%;
  min-height: var(--touch-target-lg);
  padding: var(--space-3) var(--space-4);
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--surface-2);
  }

  &:focus-visible {
    @include focus-ring(-2px);
  }
}

.head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.dot {
  flex: none;
  width: 0.625rem;
  height: 0.625rem;
  border-radius: var(--radius-pill);
}

.name {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--text-body);
  font-weight: var(--weight-medium);
  overflow-wrap: anywhere;
}

.left {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.track {
  position: relative;
  height: var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
}

.fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--accent);
}

.mark {
  position: absolute;
  top: calc(var(--space-1) * -1);
  bottom: calc(var(--space-1) * -1);
  width: calc(var(--hairline) * 2);
  background: var(--text);
}

.meta {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.over {
  color: var(--warn-ink);
}

.still {
  cursor: default;

  &:hover {
    background: none;
  }
}

.fill.over {
  background: var(--warn);
}

/* The answer comes in where the skeleton stood, faded only (MOL-138, MOL-151). */
.content > :not(:first-child) {
  @include appear(0);
}
</style>
