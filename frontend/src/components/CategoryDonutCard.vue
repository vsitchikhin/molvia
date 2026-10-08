<template>
  <AppCard class="donut">
    <RouterLink class="open" :to="{ name: 'money-charts', query }" :aria-label="label">
      <span class="heading">
        <SectionCaption as="span" inset>{{ t('spending.categories_title') }}</SectionCaption>
        <span class="charts-link">
          {{ t('spending.summary.charts') }}<IconChevron class="chevron" aria-hidden="true" />
        </span>
      </span>
      <span class="figure">
        <span class="ring-box">
          <DonutRing class="ring" :sectors="sectors" :thickness="16" />
          <span v-if="zero" class="zero">{{ zero }}</span>
        </span>
        <span v-if="top.length > 0" class="named">
          <span v-for="row in top" :key="row.key" class="sector">
            <span class="dot" :style="{ background: row.colour }"></span>
            <span class="sector-name">{{ row.name }}</span>
            <span class="sector-share">{{ row.share }}</span>
            <span class="sector-amount">{{ row.amount }}</span>
          </span>
        </span>
        <span v-else-if="waiting === 'read'" class="why">{{
          t('spending.summary.donut_later')
        }}</span>
        <span v-else-if="waiting === 'rate'" class="why">
          {{ t('spending.summary.donut_uncounted') }}
        </span>
        <span v-else-if="nothing" class="why">
          <span class="why-title">{{ nothing.title }}</span>
          <span v-if="nothing.body" class="why-body">{{ nothing.body }}</span>
        </span>
      </span>
      <span v-if="hidden > 0" class="rest">
        {{ t('spending.summary.donut_more', { n: hidden }, hidden) }}
      </span>
    </RouterLink>
  </AppCard>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconChevron from '~icons/mdi/chevron-right'
import { formatEstimate, shareOf } from '@molvia/model'
import type { MoneyMonthView, SpendingCategoryView } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'
import DonutRing from '@/components/DonutRing.vue'
import type { RingSector } from '@/components/DonutRing.vue'
import { categoryColour } from '@/components/spending'
import SectionCaption from '@/components/SectionCaption.vue'

/** How many sectors are named beside the ring; the rest are counted (handoff MOL-157, 01). */
const NAMED = 3

/**
 * «Куда ушли» on «Деньги» (MOL-156, handoff MOL-157 01): the month's ring and its three largest
 * sectors, the whole card one way into «Графики». **A month with nothing spent keeps the card, of the
 * same height** (MOL-183, С-13, handoff MOL-157 v2 «Месяц без трат»): the dashed ring of «no data»
 * with «0 ֏» in it, and beside it the running month's «В октябре трат пока нет», «Первая трата
 * октября отправляется» while one waits on the phone, a closed month's «В этом месяце трат нет» — no
 * button and no colour: the one action is «Добавить трату» in the strip. A month spent in with no
 * sectors says why beside the same ring. The sectors and their levels are the server's (`slices`) —
 * the phone adds nothing up, not even for a month kept before the ring; the share printed is the
 * model's `shareOf`, as the bars before it printed.
 */
export default defineComponent({
  name: 'CategoryDonutCard',
  components: { AppCard, DonutRing, IconChevron, SectionCaption },
  props: {
    month: { type: Object as PropType<MoneyMonthView>, required: true },
    nameOf: {
      type: Function as PropType<(category: SpendingCategoryView) => string>,
      required: true,
    },
    /** Spendings of the month still on their way: «Первая трата октября отправляется». */
    pending: { type: Number, default: 0 },
    /**
     * Spendings of the month the server refused: the month is not «empty» while one is there to be
     * put right, and it is said by its own card, not here.
     */
    refused: { type: Number, default: 0 },
    /** The month on the card is the running one: «пока» — more may come. */
    running: { type: Boolean, default: false },
  },
  setup(props) {
    const { t, locale } = useI18n()
    /**
     * Every sector of the ring. One of a category the month does not name stays on the ring, so it
     * closes, but in `--border` and with no name: called «Остальные», it passed for a second one
     * (review 7). Never happens while the month names every category, archived ones too.
     */
    const all = computed(() =>
      props.month.slices.map((slice) => {
        const category =
          slice.categoryId === null
            ? null
            : props.month.categories.find((one) => one.id === slice.categoryId)
        const share = shareOf(slice.amount, props.month.spent)
        return {
          key: slice.categoryId ?? 'rest',
          named: category !== undefined,
          name: category ? props.nameOf(category) : t('spending.charts.rest'),
          colour:
            category === undefined
              ? 'var(--border)'
              : category
                ? categoryColour(category)
                : 'var(--border-strong)',
          level: slice.level,
          amount: formatEstimate(slice.amount, locale.value),
          share: share?.tiny
            ? t('spending.share_tiny')
            : new Intl.NumberFormat(locale.value, { style: 'percent' }).format(
                (share?.percent ?? 0) / 100,
              ),
        }
      }),
    )
    const rows = computed(() => all.value.filter((row) => row.named))
    /**
     * A month with no sector drawn is still a ring, as on «Графики» (MOL-160 В-4, MOL-183 С-13): with
     * none, the card of every new month was a caption over a hole until its first spending.
     */
    const sectors = computed<RingSector[]>(() =>
      all.value.map(({ key, colour, level }) => ({ key, colour, level })),
    )
    const top = computed(() => rows.value.slice(0, NAMED))
    /** Sectors past the three that the ring draws: one of no level is on no ring (adversarial Б). */
    const hidden = computed(() => rows.value.slice(NAMED).filter((row) => row.level > 0).length)
    /** «Графики → Месяц» of the same month (MOL-158, handoff MOL-157 06): its full ring is there. */
    const query = computed(() => ({ month: props.month.month }))
    const monthPart = computed(() => props.month.month.slice(5))
    const label = computed(() => {
      if (top.value.length > 0)
        return t('spending.summary.donut_label', {
          list: top.value.map((row) => `${row.name} ${row.share}`).join(', '),
        })
      return nothing.value?.label
    })
    /**
     * No sectors, and yet the month was spent in: said beside the grey ring, never left a caption over
     * nothing (adversarial round 2, Е, Ж). Categories and no sectors — a month kept before the ring,
     * or an answer of a server older than it — waits for the next read; nothing a rate counted —
     * everything in a currency with no rate — waits for a rate. An empty month says nothing here.
     */
    const waiting = computed<'read' | 'rate' | null>(() => {
      if (props.month.slices.length > 0) return null
      if (props.month.byCategory.length > 0) return 'read'
      return props.month.uncounted.length > 0 ? 'rate' : null
    })
    /**
     * Nothing the server knows of: what is said beside the ring, and the card's name then. A refusal
     * leaves it silent — its own card says it; «нет трат» over it said two things.
     */
    const nothing = computed(() => {
      if (waiting.value !== null || props.month.days.length > 0) return null
      const month = monthPart.value
      if (props.pending > 0)
        return {
          title: t('spending.summary.donut_pending', { month: t(`spending.month_of.${month}`) }),
          body: t('spending.summary.donut_pending_body'),
          label: undefined,
        }
      if (props.refused > 0) return null
      if (!props.running) return { title: t('spending.month_empty'), body: null, label: undefined }
      const name = t(`spending.month_in.${month}`)
      return {
        title: t('spending.summary.donut_empty', { month: name }),
        body: t('spending.summary.donut_empty_body'),
        label: t('spending.summary.donut_empty_label', { month: name }),
      }
    })
    /** «0 ֏» in the dashed ring — only where it is true: nothing spent and nothing waiting a rate. */
    const zero = computed(() =>
      props.month.spent.minor === 0n &&
      waiting.value === null &&
      sectors.value.every(({ level }) => level === 0)
        ? formatEstimate(props.month.spent, locale.value)
        : null,
    )
    return { t, query, sectors, top, hidden, label, waiting, nothing, zero }
  },
})
</script>

<style scoped lang="scss">
.open {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  color: var(--text);
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;

  &:focus-visible {
    @include focus-ring(-2px);
  }
}

.heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.charts-link {
  display: inline-flex;
  align-items: center;
  color: var(--accent-ink);
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
}

.chevron {
  @include icon;

  font-size: var(--icon);
}

.figure {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

/* The ring and, in its middle, «0 ֏» of a month with nothing spent. */
.ring-box {
  display: grid;
  flex: none;
  place-items: center;
  width: 6.75rem;
  height: 6.75rem;
}

.ring,
.zero {
  grid-area: 1 / 1;
}

.ring {
  width: 100%;
  height: 100%;
}

.zero {
  @include display-type;

  color: var(--text-muted);
  font-size: var(--text-headline);
  font-variant-numeric: tabular-nums;
}

.named {
  display: grid;
  flex: 1;
  gap: var(--space-2);
  min-width: 0;
}

.sector {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  column-gap: var(--space-2);
  align-items: center;
}

.dot {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: var(--radius-pill);
}

/* The whole name, on as many lines as it takes (Е-19): cut, «Аренда и комм…» read as another. */
.sector-name {
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
  overflow-wrap: anywhere;
}

.sector-share {
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-variant-numeric: tabular-nums;
}

.sector-amount {
  grid-column: 2 / 4;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-variant-numeric: tabular-nums;
}

.rest,
.why {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.why {
  display: grid;
  flex: 1;
  gap: var(--space-1);
  min-width: 0;
}

.why-title {
  color: var(--text);
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
}
</style>
