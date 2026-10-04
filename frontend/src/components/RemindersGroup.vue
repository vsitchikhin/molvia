<template>
  <section class="group">
    <SectionCaption>{{ t('settings.group_reminders') }}</SectionCaption>
    <AppCard class="card">
      <label class="row">
        <span class="label">{{ t('settings.reminders.label') }}</span>
        <AppSwitch
          :checked="!off"
          :inactive="off === undefined || off === 'blocked' || saving || !online"
          :aria-describedby="described"
          @toggle="toggle"
        />
      </label>
      <p :id="`${id}-hint`" class="hint">{{ t('settings.reminders.hint') }}</p>
      <!-- Drawn once the answer is known, so the first answer only appears (MOL-151). -->
      <AppReveal v-if="off !== undefined">
        <p v-if="off === 'blocked'" :id="`${id}-blocked`" class="blocked">
          {{ t('settings.reminders.blocked') }}
        </p>
      </AppReveal>
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
import { computed, defineComponent, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import IconAlert from '~icons/mdi/alert-circle-outline'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppReveal from '@/components/AppReveal.vue'
import AppSwitch from '@/components/AppSwitch.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import { useReminders } from '@/composables/useReminders'

/**
 * «Напоминать об оценке в Telegram» (MOL-103): its own group under «Деньги», saved on the tap and
 * never part of the form (Р-1). Until the answer comes it shows «on», as nearly everyone has it, so
 * the switch does not cross over on every opening (review №1). **Off by a blocked bot, the switch
 * is inactive** (В-5): only an unblock brings the reminders back, and the line under it says so.
 */
export default defineComponent({
  name: 'RemindersGroup',
  components: { AppButton, AppCard, AppReveal, AppSwitch, IconAlert, SectionCaption },
  setup() {
    const { t } = useI18n()
    const id = useId()
    const reminders = useReminders()
    const described = computed(() =>
      [
        `${id}-hint`,
        reminders.off.value === 'blocked' ? `${id}-blocked` : null,
        reminders.online.value ? null : `${id}-offline`,
      ]
        .filter(Boolean)
        .join(' '),
    )
    function toggle(on: boolean): void {
      void reminders.choose(on ? null : 'chosen')
    }
    return { t, id, described, toggle, ...reminders }
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

.hint {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.blocked {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--warn-tint);
  color: var(--warn-ink);
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
