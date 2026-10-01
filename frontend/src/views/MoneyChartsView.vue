<template>
  <AppScreen :title="t('spending.charts.title')">
    <div class="content">
      <SegmentedControl
        :model-value="mode"
        :options="modes"
        :legend="t('spending.charts.mode')"
        hide-legend
        @update:model-value="chooseMode"
      />
      <template v-if="mode === 'month'">
        <MonthSwitcher :month="month" :current="currentMonth" @change="chooseMonth" />
        <ChartsMonth :month="month" />
      </template>
      <ChartsYear v-else />
    </div>
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { monthSchema } from '@molvia/model'
import AppScreen from '@/components/AppScreen.vue'
import ChartsMonth from '@/components/ChartsMonth.vue'
import ChartsYear from '@/components/ChartsYear.vue'
import MonthSwitcher from '@/components/MonthSwitcher.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { useLocalDay } from '@/composables/useLocalDay'

/**
 * «Графики» (MOL-74, MOL-158, handoff MOL-157 03 and 06): «Месяц · Год» on top and, under «Месяц»,
 * the month — both in the address, moved by `replace`, so a switch is no step «back». No `mode` is
 * the month, no `month` today's on this phone. «Год» shows the cards of MOL-74 until MOL-160. The
 * answer of each tab draws itself under the controls, never above them (MOL-138).
 */
export default defineComponent({
  name: 'MoneyChartsView',
  components: { AppScreen, ChartsMonth, ChartsYear, MonthSwitcher, SegmentedControl },
  setup() {
    const { t } = useI18n()
    const route = useRoute()
    const router = useRouter()
    const today = useLocalDay()

    const mode = computed<'month' | 'year'>(() => (route.query.mode === 'year' ? 'year' : 'month'))
    const modes = computed(() => [
      { value: 'month', label: t('spending.charts.mode_month') },
      { value: 'year', label: t('spending.charts.mode_year') },
    ])
    function chooseMode(value: string): void {
      void router.replace({
        query: { ...route.query, mode: value === 'year' ? 'year' : undefined },
      })
    }

    const currentMonth = computed(() => today.value.slice(0, 7))
    /** A month the address names, else this one; one that is not a month is this one too. */
    const month = computed(() => {
      const asked = route.query.month
      return typeof asked === 'string' && monthSchema.safeParse(asked).success
        ? asked
        : currentMonth.value
    })
    function chooseMonth(value: string): void {
      void router.replace({
        query: { ...route.query, month: value === currentMonth.value ? undefined : value },
      })
    }

    return { t, mode, modes, chooseMode, month, currentMonth, chooseMonth }
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
</style>
