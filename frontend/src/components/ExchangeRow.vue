<template>
  <li class="exchange-row">
    <!-- No `aria-label`: it would silence what the row says; the verb and the day are read first. -->
    <ListRow
      :icon="mark.icon"
      :tint="mark.tint"
      :meta="meta"
      wrap
      next
      @click="$emit('edit', exchange)"
    >
      <template #title
        ><span class="verb">{{ `${t('exchange.edit_on', { date: dayOf(exchange) })} ` }}</span
        >{{ amountsOf(exchange) }}</template
      >
      <template v-if="exchange.market?.exchangersPending" #below>
        <AppTag>{{ t('exchange.list.pending_tag') }}</AppTag>
      </template>
      <template #tail>
        <span class="sums">
          <span
            v-if="difference"
            class="amount"
            :class="mark.kind"
            :style="figureChars(difference, 'text')"
            >{{ difference }}</span
          >
          <span class="word" :class="mark.kind">{{ word }}</span>
        </span>
      </template>
    </ListRow>
  </li>
</template>

<script lang="ts">
import { computed, defineComponent, markRaw } from 'vue'
import type { Component, PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ExchangeView } from '@molvia/model'
import IconEqual from '~icons/mdi/equal'
import IconHelp from '~icons/mdi/help'
import IconMinus from '~icons/mdi/minus'
import IconPlus from '~icons/mdi/plus'
import AppTag from '@/components/AppTag.vue'
import ListRow from '@/components/ListRow.vue'
import { signedAmount } from '@/components/accounts'
import { figureChars } from '@/components/figure'
import { roundsToNought } from '@/components/spending'
import { useExchangeWords } from '@/composables/useExchangeWords'
import { calendarDayOfAnyYear, dayWords, purchaseDay, shiftDay } from '@/days'

type Kind = 'good' | 'bad' | 'even' | 'none'

const MARKS: Readonly<Record<Kind, { icon: Component; tint: string }>> = {
  good: { icon: markRaw(IconPlus), tint: 'var(--good-ink)' },
  bad: { icon: markRaw(IconMinus), tint: 'var(--bad-ink)' },
  even: { icon: markRaw(IconEqual), tint: 'muted' },
  none: { icon: markRaw(IconHelp), tint: 'muted' },
}

/**
 * One exchange in the list (MOL-348, handoff 06): its sign in a circle — the mark of the line of the
 * rate and the bar of «Обмены против рынка», one sign for the whole screen — «отдал → получил», the day
 * and the place, and in the tail the difference with the market of its day and its word. The card
 * that said all of it in five to seven lines is gone: the rate, the market and the central bank are in
 * the sheet of the amendment, which the whole row opens. The difference is the card's own measure — its
 * own channel, else the best (MOL-152) — in the currency received, the server's; its tone the money's
 * sign, never alone (Ф-30, MOL-190), and «ровно» and «без сравнения» have none.
 */
export default defineComponent({
  name: 'ExchangeRow',
  components: { AppTag, ListRow },
  props: {
    exchange: { type: Object as PropType<ExchangeView>, required: true },
    /** The screen's day (MOL-329). */
    today: { type: String, required: true },
  },
  emits: {
    edit: (exchange: ExchangeView) => typeof exchange === 'object',
  },
  setup(props) {
    const { t, locale } = useI18n()
    const { amountsOf, dayOf } = useExchangeWords()
    const measure = computed(
      () => props.exchange.market?.own ?? props.exchange.market?.best ?? null,
    )
    const kind = computed<Kind>(() => {
      const minor = measure.value?.difference.minor
      if (minor === undefined) return 'none'
      return minor > 0n ? 'good' : minor < 0n ? 'bad' : 'even'
    })
    const mark = computed(() => ({ ...MARKS[kind.value], kind: kind.value }))
    const difference = computed(() => {
      const money = measure.value?.difference
      if (!money) return null
      return signedAmount(money, locale.value, { plus: true, estimate: !roundsToNought(money) })
    })
    const word = computed(() =>
      t(
        {
          good: 'exchange.vs_market.better',
          bad: 'exchange.vs_market.worse',
          even: 'exchange.vs_market.even',
          none: 'exchange.rate_chart.no_change',
        }[kind.value],
      ),
    )
    const meta = computed(() => {
      const { exchange } = props
      const parts = [
        // «Сегодня», «Вчера» by the screen's day (MOL-121, В-1), else the date, its year when not this one.
        exchange.exchangedOn === props.today || exchange.exchangedOn === shiftDay(props.today, -1)
          ? dayWords(exchange.exchangedOn, locale.value, props.today)
          : calendarDayOfAnyYear(exchange.exchangedOn, locale.value, props.today),
        exchange.note?.trim() ? exchange.note : t('exchange.list.no_place'),
      ]
      if (exchange.amendedAt) {
        parts.push(
          t('exchange.amended', {
            date: purchaseDay(exchange.amendedAt, locale.value, props.today),
          }),
        )
      }
      return parts.join(' · ')
    })
    return { t, mark, difference, word, meta, amountsOf, dayOf, figureChars }
  },
})
</script>

<style scoped lang="scss">
/* The row lays itself out by its own width (`ListRow`, `@container row`): narrow, the tail goes under
   the words, as an operation's does (MOL-176). */
li {
  container: row / inline-size;
}

.verb {
  @include visually-hidden;
}

.sums {
  display: grid;
  justify-items: end;
}

/* Never broken, and shrunk to the row less its padding where even the whole row is narrower (MOL-321). */
.amount {
  @include figure-fit(1em, $less: calc(2 * var(--space-4)));

  white-space: nowrap;
}

.word {
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-regular);
  text-align: end;
}

.good {
  color: var(--good-ink);
}

.bad {
  color: var(--bad-ink);
}

.amount.even {
  color: var(--text);
}
</style>
