<template>
  <AppScreen :title="t('budget.title')">
    <div class="content">
      <div class="month">
        <MonthSwitcher :month="month" :current="currentMonth" @change="chooseMonth" />

        <!-- Under the switcher: they belong to the month's answer (MOL-138, owner's В-2). -->
        <StatusStrip
          v-if="stale === 'offline' && fetchedAt"
          kind="offline"
          :text="t('budget.offline_strip', { when: when(fetchedAt) })"
        />
        <StatusStrip
          v-else-if="stale === 'error' && fetchedAt"
          kind="unanswered"
          :text="t('budget.error_strip', { when: when(fetchedAt) })"
          :attempt="attempt"
        >
          <!-- The strip holds «Задать план категории», so «Повторить» is here (К-5, MOL-181). -->
          <template #action>
            <AppButton variant="ghost" @click="retry">{{ t('state.retry') }}</AppButton>
          </template>
        </StatusStrip>
      </div>

      <!-- The answer's shape (Ф-13, MOL-178): the total with its tiles, then rows with their bar. «≈»
           is drawn: the person this screen is for earns in one currency and spends in another, and a
           skeleton taller than a one-currency answer is what the hold of MOL-138 allows. -->
      <ScreenSkeleton v-if="phase === 'loading'">
        <SkeletonPart kind="figure" approx plate />
        <SkeletonPart kind="rows" :count="3" lead="circle" track next :narrow="false" />
      </ScreenSkeleton>

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
          :icon="IconTarget"
          :title="t('budget.empty.title')"
          :body="t('budget.empty.body')"
        />
        <!-- The card of a sum, as the month's on «Деньгах» (MOL-183): its caption, the figure, «≈» at
             the headline's size, and the three figures as tiles. -->
        <AppCard v-else-if="budget.total" class="total">
          <SectionCaption as="p" inset>
            {{ overall.over ? t('budget.total.over') : t('budget.total.left') }}
          </SectionCaption>
          <p class="figure" :class="{ over: overall.over }">{{ overall.figure }}</p>
          <p v-if="budget.total.leftIncome" class="approx">
            ≈ {{ amount(budget.total.leftIncome) }}
          </p>
          <!-- Two unknowns, each said on its own: a share waiting for «Пришло», and a plan or a
               spending some rate did not count (adversarial М of round 4). -->
          <p v-if="awaiting" class="footnote">{{ t('budget.total.awaiting') }}</p>
          <p v-if="short" class="footnote">{{ t('budget.total.not_whole') }}</p>
          <dl class="tiles">
            <div class="tile">
              <dt>{{ t('budget.total.planned') }}</dt>
              <dd>{{ plannedWords }}</dd>
            </div>
            <div class="tile">
              <dt>{{ t('spending.spent') }}</dt>
              <dd>{{ amount(budget.total.spent) }}</dd>
            </div>
            <div class="tile">
              <dt>{{ t('budget.total.unplanned') }}</dt>
              <dd>{{ amount(budget.total.unplanned) }}</dd>
            </div>
          </dl>
        </AppCard>

        <!-- A row is the kit's (MOL-175), its circle the category's as on «Категории» and «Траты»
             (owner's В-1 «а»). «Осталось» stands in the title's line, not in the tail: a tail of its
             own width would make every bar another length, and bars side by side are read against
             each other. A removed category is offered no plan, with one or not (review 7, adversarial
             И): no button and no chevron, its place kept so the figures and the bars stay in one
             column. -->
        <AppCard v-if="rows.length > 0" as="ul" list>
          <li v-for="row in rows" :key="row.categoryId">
            <ListRow
              :as="row.archived ? 'div' : 'button'"
              :icon="row.icon"
              :tint="row.tint"
              :next="!row.archived"
              wrap
              @click="row.archived || edit(row.categoryId, row.plan)"
            >
              <template #title>
                <span class="head">
                  <span>{{ row.name }}</span>
                  <span class="amount" :class="{ over: row.over }">{{ row.left }}</span>
                </span>
              </template>
              <template #meta>
                <span>{{ row.meta }}</span
                ><span v-if="row.used" :class="{ over: row.over }">{{ row.used }}</span>
              </template>
              <template v-if="row.archived" #tail><span class="no-chevron"></span></template>
              <template #below>
                <span class="track" aria-hidden="true">
                  <span
                    class="fill"
                    :class="{ over: row.over }"
                    :style="{ width: row.width, background: row.over ? undefined : row.fill }"
                  ></span>
                </span>
              </template>
            </ListRow>
          </li>
        </AppCard>

        <div v-if="unplanned.length > 0">
          <SectionCaption>{{ t('budget.unplanned') }}</SectionCaption>
          <AppCard as="ul" list>
            <li v-for="row in unplanned" :key="row.categoryId">
              <ListRow
                :as="row.archived ? 'div' : 'button'"
                :icon="row.icon"
                :tint="row.tint"
                :meta="row.meta"
                :next="!row.archived"
                wrap
                @click="row.archived || edit(row.categoryId, null)"
              >
                <template #title>
                  <span class="head">
                    <span>{{ row.name }}</span>
                    <span class="amount">{{ row.spent }}</span>
                  </span>
                </template>
                <template v-if="row.archived" #tail><span class="no-chevron"></span></template>
              </ListRow>
            </li>
          </AppCard>
        </div>

        <!-- The target has no category's colour: its circle is quiet, its bar `--graphic` — data
             without a colour of its own — and the mark of the target the ink of the text. -->
        <AppCard as="section" list :aria-labelledby="`${id}-savings`">
          <ListRow
            :icon="IconPiggyBank"
            tint="muted"
            :meta="savings.meta"
            next
            wrap
            @click="editSavings"
          >
            <template #title>
              <span class="head">
                <span :id="`${id}-savings`">{{ t('budget.savings.title') }}</span>
                <span class="amount">{{ savings.actual }}</span>
              </span>
            </template>
            <template v-if="savings.width !== null" #below>
              <span class="track" aria-hidden="true">
                <span class="fill" :style="{ width: savings.width }"></span>
                <span v-if="savings.target" class="mark" :style="{ left: savings.target }"></span>
              </span>
            </template>
          </ListRow>
        </AppCard>
      </template>
    </div>

    <!-- The main action is the strip (Ф-28), over an answer only: before one the sheet knows nothing
         to choose (MOL-191, В-2), and with every live category planned there is nothing to offer. A
         plan is written with a connection only (Р-8 of MOL-117), so offline it is not now, saying why
         (Ф-6). An error takes the strip for «Повторить» by itself. -->
    <template v-if="phase === 'ready' && choosable.length > 0" #docked>
      <AppButton size="large" block :inactive="!online" @click="choose">
        <template #icon><IconPlus v-if="online" /><IconCloudOff v-else /></template>
        {{ online ? t('budget.add') : t('budget.add_offline') }}
      </AppButton>
    </template>

    <BudgetPlanSheet
      v-model:open="sheetOpen"
      :month="month"
      :subject="subject"
      :plan="plan"
      :categories="choosable"
      :name-of="nameOf"
      :spend-currency="budget?.spendCurrency ?? 'AMD'"
      :online="online"
      :save="save"
      @done="done"
    />
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import IconPiggyBank from '~icons/mdi/piggy-bank-outline'
import IconPlus from '~icons/mdi/plus'
import IconTarget from '~icons/mdi/target'
import { monthSchema } from '@molvia/model'
import type { BudgetPlanValue, Money, SpendingCategoryView } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppScreen from '@/components/AppScreen.vue'
import ListRow from '@/components/ListRow.vue'
import BudgetPlanSheet from '@/components/BudgetPlanSheet.vue'
import type { BudgetOutcome, BudgetSubject } from '@/components/BudgetPlanSheet.vue'
import MonthSwitcher from '@/components/MonthSwitcher.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import { countedWhen } from '@/components/accounts'
import { budgetAmount, spendingLook } from '@/components/spending'
import SectionCaption from '@/components/SectionCaption.vue'
import SkeletonPart from '@/components/SkeletonPart.vue'
import StatusStrip from '@/components/StatusStrip.vue'
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
    ListRow,
    MonthSwitcher,
    ScreenSkeleton,
    ScreenState,
    SectionCaption,
    SkeletonPart,
    StatusStrip,
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

    const { phase, budget, stale, fetchedAt, attempt, retry, save } = useMoneyBudget(month)

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
    /** The circle of a row, and its bar in the category's colour (Ф-4) — `--graphic` for none known. */
    const lookOf = (categoryId: string) => {
      const look = spendingLook(categoryOf(categoryId) ?? null)
      return { ...look, fill: look.tint === 'muted' ? 'var(--graphic)' : look.tint }
    }

    /** A figure without its sign — the words around it say which way (Р-7, adversarial Г). */
    const amount = (value: Money) => budgetAmount(value, locale.value)
    const percent = (value: number) =>
      new Intl.NumberFormat(locale.value, { style: 'percent' }).format(value / 100)
    const when = (at: Date) => countedWhen(at, locale.value)

    const overall = computed(() => {
      // No row counted, or over a plan known in part: «осталось» is not said as a figure (review 9, 10).
      const left = budget.value?.total?.left
      if (!left) return { over: false, figure: '—' }
      return { over: left.minor < 0n, figure: amount(left) }
    })
    /**
     * «План» of the total, and «и ещё» while some row with a plan is in no figure of it — its spending
     * is in «Потрачено», so the three are not one sum (review 12, adversarial Л).
     */
    const plannedWords = computed(() => {
      const total = budget.value?.total
      if (!total?.planned) return '—'
      return total.planShort
        ? t('budget.total.planned_more', { amount: amount(total.planned) })
        : amount(total.planned)
    })
    /** Some share waits for «Пришло»: the total says that, not «нет курса» (review 1). */
    const awaiting = computed(() => (budget.value?.rows ?? []).some((row) => row.awaitingIncome))
    /**
     * A plan or a spending some rate did not count — the server's flags of the rows; a share waiting
     * for «Пришло» is whole in both and says its own words above (adversarial М of round 4).
     */
    const short = computed(() =>
      (budget.value?.rows ?? []).some((row) => !row.plannedWhole || !row.spentWhole),
    )

    const rows = computed(() =>
      (budget.value?.rows ?? []).map((row) => {
        const over = row.left !== null && row.left.minor < 0n
        // «≈» before a plan the server converted by the month's rate (review 2, adversarial Б, Р-4).
        const planned =
          row.planned === null ? '—' : `${row.estimated ? '≈ ' : ''}${amount(row.planned)}`
        const notes = [
          ...(row.plan.kind === 'share'
            ? [t('budget.row.share', { percent: row.plan.percent })]
            : []),
          ...(row.awaitingIncome ? [t('budget.row.awaiting')] : []),
          ...(!row.plannedWhole || !row.spentWhole
            ? [t('spending.charts.difference_uncounted')]
            : []),
        ]
        const archived = categoryOf(row.categoryId)?.archived === true
        const used = over ? t('budget.row.over') : row.used === null ? '' : percent(row.used)
        return {
          categoryId: row.categoryId,
          plan: row.plan,
          name: nameOf(row.categoryId),
          ...lookOf(row.categoryId),
          archived,
          over,
          // Over the plan is said by the words beside it, never by a minus (Р-7, review 5).
          left: row.left === null ? '—' : amount(row.left),
          // Why a removed one does not open is said on it (MOL-192).
          meta: [
            t('budget.row.of', { spent: amount(row.spent), planned }),
            ...notes,
            ...(archived ? [t('budget.row.archived')] : []),
          ].join(' · '),
          used: used ? ` · ${used}` : '',
          // The share is the server's; the phone only stops the bar at the card's edge.
          width: `${String(Math.min(row.used ?? (over ? 100 : 0), 100))}%`,
        }
      }),
    )

    const unplanned = computed(() =>
      (budget.value?.unplanned ?? []).map((row) => {
        const archived = categoryOf(row.categoryId)?.archived === true
        return {
          categoryId: row.categoryId,
          name: nameOf(row.categoryId),
          ...lookOf(row.categoryId),
          archived,
          spent: amount(row.spent),
          meta: [
            ...(row.spentWhole ? [] : [t('spending.charts.difference_uncounted')]),
            ...(archived ? [t('budget.row.archived')] : []),
          ].join(' · '),
        }
      }),
    )

    /** Live categories with no row yet: the ones «Задать план» offers. */
    const choosable = computed(() => {
      const shown = new Set((budget.value?.rows ?? []).map((row) => row.categoryId))
      return categories.value.filter((category) => !category.archived && !shown.has(category.id))
    })

    const running = computed(() => month.value === currentMonth.value)
    const savings = computed(() => {
      const value = budget.value?.savings
      if (!value) return { actual: '', meta: '', width: null, target: null }
      const actual =
        value.actual === null
          ? '—'
          : running.value
            ? t('budget.savings.so_far', { percent: percent(value.actual) })
            : percent(value.actual)
      const goal =
        value.target === null
          ? t('budget.savings.no_target')
          : t('budget.savings.target', { percent: value.target })
      const of = value.difference
        ? t('budget.savings.of', {
            difference:
              value.difference.minor < 0n
                ? `−${amount(value.difference)}`
                : amount(value.difference),
            income: amount(value.income),
          })
        : value.income.minor === 0n
          ? t('budget.savings.no_income')
          : t('budget.savings.not_whole')
      return {
        actual,
        meta: `${goal} · ${of}`,
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
    /** The write's answer is already shown by `save` (review 6); the outcome is only said. */
    function done(outcome: BudgetOutcome): void {
      announce?.(
        t(outcome.kind === 'saved' ? 'budget.saved' : 'budget.removed', { name: outcome.name }),
      )
    }

    return {
      t,
      id,
      IconPiggyBank,
      IconTarget,
      month,
      currentMonth,
      chooseMonth,
      phase,
      budget,
      stale,
      fetchedAt,
      attempt,
      retry,
      save,
      online,
      amount,
      when,
      overall,
      plannedWords,
      awaiting,
      short,
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
/* The field is `AppScreen`'s 16 (С-23); 24 between the groups of the answer, 8 under the switcher
   for what belongs to it (Ф-10). */
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

.total {
  display: grid;
  gap: var(--space-1);
}

.figure {
  @include display-type;

  margin: 0;
  font-size: var(--text-figure);
  font-variant-numeric: tabular-nums;
  line-height: var(--leading-tight);

  &.over {
    color: var(--warn-ink);
  }
}

.approx {
  margin: 0;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
  line-height: var(--leading-tight);
}

.footnote {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

/* The tiles of the month's card (MOL-183), three across: a figure that cannot fit a third of a phone
   of 320 breaks rather than stand past its tile. */
.tiles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
  margin: var(--space-3) 0 0;
}

.tile {
  display: grid;
  align-content: start;
  gap: var(--space-1);
  padding: var(--space-2);
  border-radius: var(--radius);
  background: var(--surface-2);

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

/* The name and its figure on the title's line; the figure goes under it, at the right, once the
   whole name no longer fits beside it (MOL-200). */
.head {
  @include name-beside-figure;
}

.amount {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* A removed category's row keeps the chevron's place empty, so its figure and its bar end where the
   live rows' do. */
.no-chevron {
  width: var(--icon);
}

.track {
  position: relative;
  display: block;
  height: var(--space-2);
  margin-top: var(--space-1);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
}

/* A category's bar is its colour, set on the row (Ф-4); the target's, with no colour of its own,
   is data's (`--graphic`). */
.fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--graphic);
}

.mark {
  position: absolute;
  top: calc(var(--space-1) * -1);
  bottom: calc(var(--space-1) * -1);
  width: calc(var(--hairline) * 2);
  background: var(--text);
}

.over {
  color: var(--warn-ink);
}

.fill.over {
  background: var(--warn);
}

/* The answer comes in where the skeleton stood, faded only (MOL-138, MOL-151). */
.content > :not(:first-child) {
  @include appear(0);
}
</style>
