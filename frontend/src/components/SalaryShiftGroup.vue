<template>
  <section class="group">
    <h2 class="caption">{{ t('settings.group_money') }}</h2>
    <AppCard class="card">
      <label class="row">
        <span class="label">{{ t('settings.salary_shift.label') }}</span>
        <input
          class="switch"
          type="checkbox"
          role="switch"
          :checked="!!day"
          :disabled="day === undefined || saving || !online"
          :aria-describedby="online ? `${id}-hint` : `${id}-hint ${id}-offline`"
          @change="toggle"
        />
      </label>
      <AppReveal>
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
        {{ t('settings.salary_shift.offline') }}
      </p>
      <p v-else-if="saveFailed" class="failed" role="alert">
        <IconAlert aria-hidden="true" />{{ t('settings.salary_shift.save_failed') }}
      </p>
      <div v-else-if="failure === 'error'" class="failed">
        <IconAlert aria-hidden="true" />
        <span>{{ t('settings.salary_shift.load_error') }}</span>
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
import { SALARY_SHIFT_DEFAULT, useSalaryShift } from '@/composables/useSalaryShift'

/**
 * «Зарплата с … числа — в следующий месяц» (MOL-134, В-3): its own group under the form, saved on
 * the tap (В-5) — the switch turns it on at the owner's 25th, the native select moves the day.
 */
export default defineComponent({
  name: 'SalaryShiftGroup',
  components: { AppButton, AppCard, AppField, AppReveal, IconAlert },
  setup() {
    const { t } = useI18n()
    const shift = useSalaryShift()
    const days = Array.from({ length: SALARY_SHIFT_DAY_MAX }, (_, index) => ({
      value: String(index + 1),
      label: t('settings.salary_shift.day_option', { day: index + 1 }),
    }))
    function toggle(event: Event): void {
      const on = (event.target as HTMLInputElement).checked
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
  display: grid;
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

.switch {
  position: relative;
  flex: none;
  width: var(--switch-width);
  height: var(--switch-height);
  margin: 0;
  border-radius: var(--radius-pill);
  background: var(--border-strong);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease);
  appearance: none;

  &::before {
    position: absolute;
    top: var(--space-1);
    left: var(--space-1);
    width: calc(var(--switch-height) - 2 * var(--space-1));
    height: calc(var(--switch-height) - 2 * var(--space-1));
    border-radius: 50%;
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    transition: transform var(--dur-fast) var(--ease);
    content: '';
  }

  &:checked {
    background: var(--accent-solid);
  }

  &:checked::before {
    transform: translateX(calc(var(--switch-width) - var(--switch-height)));
  }

  &:disabled {
    cursor: default;
    opacity: var(--opacity-stale);
  }

  &:focus-visible {
    @include focus-ring;
  }
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

@media (prefers-reduced-motion: reduce) {
  .switch,
  .switch::before {
    transition: none;
  }
}
</style>
