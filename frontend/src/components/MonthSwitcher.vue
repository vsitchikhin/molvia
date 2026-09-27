<template>
  <AppCard class="switcher">
    <AppButton
      variant="icon"
      :label="t('spending.month_prev')"
      class="step"
      @click="$emit('change', previous)"
    >
      <IconLeft />
    </AppButton>
    <h2 class="month">{{ title }}</h2>
    <AppButton
      variant="icon"
      :label="t('spending.month_next')"
      class="step"
      :inactive="!next"
      @click="next && $emit('change', next)"
    >
      <IconRight />
    </AppButton>
  </AppCard>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
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
 * «‹ Сентябрь 2026 ›» (MOL-82, handoff 01). The future is not a month to look at; the past has no
 * lower bound — the server names no first month, and an empty one says so itself (Р-1). No swipe:
 * a gesture here would fight the system «back» on iOS.
 */
export default defineComponent({
  name: 'MonthSwitcher',
  components: { AppButton, AppCard, IconLeft, IconRight },
  props: {
    month: { type: String, required: true },
    /** This month in Yerevan: the last one there is to see. */
    current: { type: String, required: true },
  },
  emits: ['change'],
  setup(props) {
    const { t, locale } = useI18n()
    const title = computed(() => {
      const text = monthOf(props.month, locale.value)
      return text.charAt(0).toLocaleUpperCase(locale.value) + text.slice(1)
    })
    const previous = computed(() => previousMonth(props.month))
    const next = computed(() => (props.month < props.current ? nextMonth(props.month) : null))
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
  margin: 0;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
  text-align: center;
}

.step {
  background: transparent;
  color: var(--accent-ink);

  &:hover {
    background: var(--accent-tint);
  }

  &[aria-disabled='true'] {
    opacity: 0.35;
  }
}
</style>
