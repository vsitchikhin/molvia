<template>
  <AppScreen :title="t('bot.title')">
    <ScreenSkeleton v-if="phase === 'loading'" :groups="[64, 78]" />

    <ScreenState
      v-else-if="phase === 'error'"
      kind="error"
      :title="t('bot.load_error.title')"
      :body="t('bot.load_error.body')"
      @retry="retry"
    />

    <!-- No button: the switches are the server's word, and the screen loads by itself once the
         connection is back (useTapSetting reads again on reconnect). -->
    <ScreenState
      v-else-if="phase === 'offline'"
      kind="offline"
      tone="warn"
      :title="t('bot.offline.title')"
      :body="t('bot.offline.body')"
    />

    <section v-else class="group">
      <!-- Under a block nothing comes, whatever the switches say: said once, for every kind (Р-10). -->
      <p v-if="blocked" :id="`${id}-blocked`" class="blocked">{{ t('bot.blocked') }}</p>
      <SectionCaption>{{ t('bot.group_messages') }}</SectionCaption>
      <AppCard as="ul" list>
        <BotSwitchRow
          :label="t('bot.reminders.label')"
          :hint="t('bot.reminders.hint')"
          :checked="reminders.off.value !== 'chosen'"
          :inactive="blocked || reminders.saving.value || !online"
          :save-failed="reminders.saveFailed.value"
          :noted-by="notes"
          @toggle="chooseReminders"
        />
        <BotSwitchRow
          :label="t('bot.receipts.label')"
          :hint="t('bot.receipts.hint')"
          :checked="notices.off.value === false"
          :inactive="blocked || notices.saving.value || !online"
          :save-failed="notices.saveFailed.value"
          :noted-by="notes"
          @toggle="chooseNotices"
        />
      </AppCard>
      <!-- Said once for every switch, as the block is (review №5), and under them: a note goes under
           the control it is about (MOL-136). -->
      <p v-if="!online" :id="`${id}-offline`" class="note">{{ t('settings.tap.offline') }}</p>
    </section>
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import AppCard from '@/components/AppCard.vue'
import AppScreen from '@/components/AppScreen.vue'
import BotSwitchRow from '@/components/BotSwitchRow.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import { useReceiptNotices } from '@/composables/useReceiptNotices'
import { useReminders } from '@/composables/useReminders'

/**
 * «Бот в Telegram» (MOL-129, В-2), under «Настройки»: a switch for each kind of the bot's messages,
 * each saved on the tap at its own address — the rating reminders (MOL-103) and «чек разобран». The
 * next kind is one more row here.
 *
 * **A block is the bot's, not a kind's** (Р-10): under it both switches are inactive and show what
 * the person chose — the reminders' «on», since a block never overwrites «chosen» (MOL-103 В-1) — and
 * one line above says why nothing comes. Only an unblock lifts it (В-5).
 */
export default defineComponent({
  name: 'BotView',
  components: { AppCard, AppScreen, BotSwitchRow, ScreenSkeleton, ScreenState, SectionCaption },
  setup() {
    const { t } = useI18n()
    const id = useId()
    const reminders = useReminders()
    const notices = useReceiptNotices()
    // The block is the bot's (review №1): the reminders' column says it only over «on», so the
    // receipts' answer carries it too — a block over «chosen» is there alone.
    const blocked = computed(() => notices.blocked.value || reminders.off.value === 'blocked')
    const online = computed(() => reminders.online.value && notices.online.value)
    const notes = computed(() =>
      [blocked.value ? `${id}-blocked` : null, online.value ? null : `${id}-offline`].filter(
        (note): note is string => note !== null,
      ),
    )

    // Four states (MOL-19): the page shows both switches or neither, and offline or error is decided
    // after the failure — a failure of either read is the page's.
    const phase = computed(() => {
      const failures = [reminders.failure.value, notices.failure.value]
      if (failures.includes('error')) return 'error'
      if (failures.includes('offline')) return 'offline'
      if (reminders.off.value === undefined || notices.off.value === undefined) return 'loading'
      return 'ready'
    })

    async function retry(): Promise<void> {
      await Promise.all([reminders.retry(), notices.retry()])
    }
    function chooseReminders(on: boolean): void {
      void reminders.choose(on ? null : 'chosen')
    }
    function chooseNotices(on: boolean): void {
      void notices.choose(!on)
    }
    return {
      t,
      id,
      reminders,
      notices,
      blocked,
      online,
      notes,
      phase,
      retry,
      chooseReminders,
      chooseNotices,
    }
  },
})
</script>

<style scoped lang="scss">
.note {
  margin: var(--space-3) 0 0;
  padding: 0 var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.blocked {
  margin: 0 0 var(--space-4);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--warn-tint);
  color: var(--warn-ink);
  font-size: var(--text-footnote);
}
</style>
