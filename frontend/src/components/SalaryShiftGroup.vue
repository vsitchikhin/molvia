<template>
  <section class="group">
    <h2 class="caption">{{ t('settings.group_money') }}</h2>
    <AppCard class="card">
      <label class="row">
        <span class="label">{{ t('settings.salary_shift.label') }}</span>
        <AppSwitch
          :checked="!!day"
          :disabled="day === undefined || saving || !online"
          :aria-describedby="online ? `${id}-hint` : `${id}-hint ${id}-offline`"
          @toggle="toggle"
        />
      </label>
      <!-- Drawn once the answer is known, so the first answer only appears (MOL-151). -->
      <AppReveal v-if="day !== undefined">
        <AppField
          v-if="day"
          :model-value="String(day)"
          :label="t('settings.salary_shift.day')"
          kind="select"
          :options="days"
          :disabled="saving || !online"
          @update:model-value="choose(Number($event))"
        />
      </AppReveal>
      <p :id="`${id}-hint`" class="hint">{{ t('settings.salary_shift.hint') }}</p>
      <p v-if="!online" :id="`${id}-offline`" class="hint">
        {{ t('settings.tap.offline') }}
      </p>
      <p v-else-if="saveFailed" class="failed" role="alert">
        <IconAlert aria-hidden="true" />{{ t('settings.tap.save_failed') }}
      </p>
      <div v-else-if="failure === 'error'" class="failed">
        <IconAlert aria-hidden="true" />
        <span>{{ t('settings.tap.load_error') }}</span>
        <AppButton variant="ghost" @click="retry">{{ t('state.retry') }}</AppButton>
      </div>
    </AppCard>
  </section>
</template>

<script lang="ts">
import { defineComponent, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { SALARY_SHIFT_DAY_MAX } from '@molvia/model'
import IconAlert from '~icons/mdi/alert-circle-outline'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppField from '@/components/AppField.vue'
import AppReveal from '@/components/AppReveal.vue'
import AppSwitch from '@/components/AppSwitch.vue'
import { SALARY_SHIFT_DEFAULT, useSalaryShift } from '@/composables/useSalaryShift'

/**
 * «Зарплата с … числа — в следующий месяц» (MOL-134, В-3): its own group under the form, saved on
 * the tap (В-5) — the switch turns it on at the owner's 25th, the native select moves the day.
 */
export default defineComponent({
  name: 'SalaryShiftGroup',
  components: { AppButton, AppCard, AppField, AppReveal, AppSwitch, IconAlert },
  setup() {
    const { t } = useI18n()
    const shift = useSalaryShift()
    const days = Array.from({ length: SALARY_SHIFT_DAY_MAX }, (_, index) => ({
      value: String(index + 1),
      label: t('settings.salary_shift.day_option', { day: index + 1 }),
    }))
    function toggle(on: boolean): void {
      void shift.choose(on ? SALARY_SHIFT_DEFAULT : null)
    }
    return { t, id: useId(), days, toggle, ...shift }
  },
})
</script>

<style scoped lang="scss">
.caption {
  margin: 0 0 var(--space-3);
  padding: var(--space-1) var(--space-1) 0;
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: var(--touch-target);
  cursor: pointer;
}

.label {
  min-width: 0;
  overflow-wrap: anywhere;
}

.hint {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.failed {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  color: var(--bad-ink);
  font-size: var(--text-footnote);

  svg {
    flex: none;
    width: var(--space-4);
    height: var(--space-4);
  }
}
</style>
