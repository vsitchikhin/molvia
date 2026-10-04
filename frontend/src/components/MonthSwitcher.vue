<template>
  <AppCard class="switcher">
    <AppButton
      variant="icon"
      :label="t(unit === 'year' ? 'spending.year_prev' : 'spending.month_prev')"
      :inactive="!previous"
      @click="previous && $emit('change', previous)"
    >
      <IconLeft />
    </AppButton>
    <h2 class="month">{{ title }}</h2>
    <AppButton
      variant="icon"
      :label="t(unit === 'year' ? 'spending.year_next' : 'spending.month_next')"
      :inactive="!next"
      @click="next && $emit('change', next)"
    >
      <IconRight />
    </AppButton>
  </AppCard>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconLeft from '~icons/mdi/chevron-left'
import IconRight from '~icons/mdi/chevron-right'
import { previousMonth } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import { monthOf } from '@/days'

function nextMonth(month: string): string {
  const [year = 0, number = 1] = month.split('-').map(Number)
  return number === 12
    ? `${String(year + 1)}-01`
    : `${String(year)}-${String(number + 1).padStart(2, '0')}`
}

/**
 * «‹ Сентябрь 2026 ›» (MOL-82, handoff 01), or «‹ 2026 ›» (MOL-160). The future is not a month to
 * look at; the past of a month has no lower bound — the server names no first month, and an empty one
 * says so itself (Р-1) — and of a year goes back as far as there is anything (Р-9). No swipe:
 * a gesture here would fight the system «back» on iOS. The arrows are the kit's icon button, and
 * the one at the edge is its inactive look — focusable, `text-muted`, no opacity (Ф-6, MOL-174).
 */
export default defineComponent({
  name: 'MonthSwitcher',
  components: { AppButton, AppCard, IconLeft, IconRight },
  props: {
    month: { type: String, required: true },
    /** This month in Yerevan: the last one there is to see. */
    current: { type: String, required: true },
    /**
     * «‹ 2026 ›» (MOL-160, handoff MOL-157 07): `month` and `current` are then years, `YYYY`.
     */
    unit: { type: String as PropType<'month' | 'year'>, default: 'month' },
    /**
     * The first there is to see; null — no lower bound. The year has one, the first year with
     * anything in it (Р-9); the month has none, since the server names no first month (Р-1).
     */
    first: { type: String as PropType<string | null>, default: null },
  },
  emits: ['change'],
  setup(props) {
    const { t, locale } = useI18n()
    const title = computed(() => {
      if (props.unit === 'year') return props.month
      const text = monthOf(props.month, locale.value)
      return text.charAt(0).toLocaleUpperCase(locale.value) + text.slice(1)
    })
    const step = (by: number) =>
      props.unit === 'year'
        ? String(Number(props.month) + by)
        : by < 0
          ? previousMonth(props.month)
          : nextMonth(props.month)
    const previous = computed(() =>
      props.first !== null && props.month <= props.first ? null : step(-1),
    )
    const next = computed(() => (props.month < props.current ? step(1) : null))
    return { t, title, previous, next }
  },
})
</script>

<style scoped lang="scss">
.switcher {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-1);
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-sm);
}

.month {
  min-width: 0;
  margin: 0;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
  text-align: center;
  white-space: nowrap;
}
</style>
