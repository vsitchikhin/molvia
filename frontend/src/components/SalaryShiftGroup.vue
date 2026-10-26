<template>
  <section class="group">
    <SectionCaption>{{ t('settings.group_money') }}</SectionCaption>
    <AppCard ref="card" class="card">
      <label class="row">
        <span class="label">{{ t('settings.salary_shift.label') }}</span>
        <!-- A change still unsure draws no switch and no day (MOL-96, Р3-А3): its place held. -->
        <span class="switch-slot">
          <AppSwitch
            v-if="!unsure"
            :checked="!!day"
            :inactive="day === undefined || saving || !online"
            :aria-describedby="online ? `${id}-hint` : `${id}-hint ${id}-offline`"
            @toggle="toggle"
          />
        </span>
      </label>
      <!-- Drawn once the answer is known, so the first answer only appears (MOL-151). -->
      <AppReveal v-if="day !== undefined">
        <AppField
          v-if="day && !unsure"
          :model-value="String(day)"
          :label="t('settings.salary_shift.day')"
          kind="select"
          :options="days"
          :disabled="saving || !online"
          @update:model-value="choose(Number($event))"
        />
      </AppReveal>
      <p :id="`${id}-hint`" class="hint">{{ t('settings.salary_shift.hint') }}</p>
      <TapUnsureLine
        v-if="unsure"
        ref="line"
        :pending="pending"
        :online="online"
        :aria-describedby="`${id}-hint`"
        @retry="retry"
      />
      <p v-if="!online" :id="`${id}-offline`" class="hint">
        {{ t('settings.tap.offline') }}
      </p>
      <p v-else-if="saveFailed && !unsure" class="failed" role="alert">
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
import { defineComponent, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { SALARY_SHIFT_DAY_MAX } from '@molvia/model'
import IconAlert from '~icons/mdi/alert-circle-outline'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppField from '@/components/AppField.vue'
import AppReveal from '@/components/AppReveal.vue'
import AppSwitch from '@/components/AppSwitch.vue'
import TapUnsureLine from '@/components/TapUnsureLine.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import { SALARY_SHIFT_DEFAULT, useSalaryShift } from '@/composables/useSalaryShift'
import { useUnsureFocus } from '@/composables/useUnsureFocus'

/**
 * «Зарплата с … числа — в следующий месяц» (MOL-134, В-3): its own group under the form, saved on
 * the tap (В-5) — the switch turns it on at the owner's 25th, the native select moves the day.
 */
export default defineComponent({
  name: 'SalaryShiftGroup',
  components: {
    AppButton,
    AppCard,
    AppField,
    AppReveal,
    AppSwitch,
    IconAlert,
    SectionCaption,
    TapUnsureLine,
  },
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
    // The switch and the day go while a change is unsure: the focus a tap left in the card waits
    // on the line and goes back to the switch.
    const card = ref<{ $el: HTMLElement } | null>(null)
    const line = ref<{ $el: HTMLElement } | null>(null)
    useUnsureFocus(
      shift.unsure,
      shift.pending,
      () => card.value?.$el,
      () => line.value?.$el,
    )
    return { t, id: useId(), days, toggle, card, line, ...shift }
  },
})
</script>

<style scoped lang="scss">
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

// The switch's place, held while its change is unsure: the words do not move when it comes back.
.switch-slot {
  display: flex;
  flex: none;
  justify-content: flex-end;
  min-width: var(--switch-width);
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
    @include icon;

    font-size: var(--icon-sm);
  }
}
</style>
