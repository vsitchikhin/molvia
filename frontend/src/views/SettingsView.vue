<template>
  <AppScreen :title="t('settings.title')">
    <ScreenSkeleton v-if="form.loading && !form.draft" :groups="[32]">
      <div class="skeleton-card">
        <span class="skeleton-label"></span><span class="skeleton-field"></span>
      </div>
      <div class="skeleton-card">
        <span class="skeleton-field"></span><span class="skeleton-field"></span>
      </div>
    </ScreenSkeleton>
    <ScreenState
      v-else-if="!form.draft && !online"
      kind="offline"
      tone="warn"
      :title="t('settings.offline.title')"
      :body="t('settings.offline.body')"
    />
    <ScreenState
      v-else-if="online && form.failure && !form.unknown && !form.saveError"
      kind="error"
      :inline="!!form.draft"
      :title="t('settings.load_error.title')"
      :body="t('settings.load_error.body')"
      @retry="form.refresh"
    />
    <template v-if="form.draft">
      <p v-if="!online" class="offline">
        <IconCloud aria-hidden="true" />{{ t('settings.offline.strip') }}
      </p>
      <AppReveal>
        <AppCard
          v-if="form.dirty && !form.unknown && (form.returned || form.conflict || !form.stored)"
          class="draft"
        >
          <span class="pencil" aria-hidden="true"><IconPencil class="pencil-icon" /></span>
          <div>
            <p class="draft-title">{{ t('settings.draft.title') }}</p>
            <p v-if="!form.stored" class="note">{{ t('settings.draft.volatile') }}</p>
            <AppButton variant="ghost" :inactive="form.saving" @click="form.cancel">{{
              t('settings.cancel')
            }}</AppButton>
          </div>
        </AppCard>
      </AppReveal>
      <ScreenState
        v-if="form.conflict && form.current && !form.unknown"
        kind="attention"
        inline
        :title="t('settings.conflict.title')"
        :body="t('settings.conflict.body', saidIn(form.current))"
      />
      <form class="form" @submit.prevent="form.save">
        <SettingsFields
          :model-value="form.draft"
          :base="form.base"
          :disabled="form.saving || form.unknown"
          :uncertain="form.unknown"
          @update:model-value="form.edit"
        />
        <p class="note">{{ t('settings.scope') }}</p>
      </form>
    </template>
    <!-- Saved on the tap, beside the form and never under its «Сохранить»: the form's four fields
         are also a trip's context (MOL-134, Н-1, В-5). -->
    <SalaryShiftGroup class="group" />
    <!-- The same, for the bot's rating reminders (MOL-103, Р-1). -->
    <RemindersGroup class="group" />
    <!-- This device's own, not the account's: nothing goes to the server (MOL-111). -->
    <SchemeGroup class="group" />
    <!-- Outside the form's states: the way into the account does not depend on whether its
         settings loaded (MOL-57). -->
    <section class="group">
      <h2 class="caption">{{ t('settings.group_account') }}</h2>
      <AppCard as="ul" list>
        <li>
          <RouterLink class="entry" :to="{ name: 'devices' }">
            <IconDevices class="entry-icon" aria-hidden="true" />
            <span class="entry-label">{{ t('devices.title') }}</span>
            <IconChevron class="entry-chevron" aria-hidden="true" />
          </RouterLink>
        </li>
        <!-- Here and not beside «Это устройство» in the list: leaving a laptop that is not yours
             is «quickly, then go», and it is looked for on this screen (owner's decision Q3). -->
        <li>
          <button class="entry leave" type="button" @click="askToLeave">
            <IconLogout class="entry-icon" aria-hidden="true" />
            <span class="entry-label">{{ t('settings.sign_out') }}</span>
          </button>
        </li>
      </AppCard>
    </section>
    <!-- «Написать разработчику» (MOL-147): opens the app's one sheet rather than a screen, as «Выйти»
         and «Удалить мои данные» do, so there is no chevron. Offline it opens all the same: written
         now, sent once there is a connection. -->
    <section class="group">
      <h2 class="caption">{{ t('settings.group_app') }}</h2>
      <AppCard as="ul" list>
        <li>
          <button
            class="entry opener"
            type="button"
            aria-haspopup="dialog"
            :aria-describedby="`${id}-feedback`"
            @click="feedback.open({ from: 'settings' })"
          >
            <IconMessage class="entry-icon" aria-hidden="true" />
            <span class="entry-text">
              <span class="entry-label">{{ t('settings.feedback.label') }}</span>
              <span :id="`${id}-feedback`" class="entry-hint">{{
                t('settings.feedback.hint')
              }}</span>
            </span>
          </button>
        </li>
      </AppCard>
    </section>
    <YourDataGroup />
    <SignOutSheet
      v-model:open="leaveOpen"
      :unsent="unsent"
      :busy="signOut.leaving"
      :offline="!online"
      :failure="signOut.logoutFailure"
      @confirm="signOut.leave"
    />
    <template #docked>
      <div class="actions">
        <div
          v-if="notice"
          :id="`${id}-notice`"
          class="notice"
          :class="notice.tone"
          :role="notice.tone === 'error' ? 'alert' : hasAnnouncer ? undefined : 'status'"
        >
          <IconCheck v-if="notice.tone === 'success'" aria-hidden="true" />
          <IconAlert v-else-if="notice.tone === 'error'" aria-hidden="true" />
          <IconCloud v-else aria-hidden="true" />
          <div>
            <p class="message-title">{{ notice.title }}</p>
            <p v-if="notice.body" class="message-body">{{ notice.body }}</p>
            <p v-if="form.unknown && !form.stored" class="message-body">
              {{ t('settings.draft.volatile') }}
            </p>
          </div>
        </div>
        <p v-else-if="!online" :id="`${id}-notice`" class="note">
          {{ t('settings.save_needs_network') }}
        </p>
        <AppButton
          block
          :inactive="!online || !form.dirty || form.loading || form.unknown"
          :busy="form.saving"
          :aria-describedby="notice || !online ? `${id}-notice` : undefined"
          @click="form.save"
        >
          <template v-if="form.saveError && online && !form.saving" #icon><IconRefresh /></template>
          {{
            form.saving
              ? t('settings.saving')
              : form.saveError && online
                ? t('state.retry')
                : form.conflict
                  ? t('settings.overwrite')
                  : t('settings.save')
          }}
        </AppButton>
      </div>
    </template>
  </AppScreen>
</template>
<script lang="ts">
import { computed, defineComponent, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ActorSettings } from '@molvia/model'
import IconCloud from '~icons/mdi/cloud-off-outline'
import IconPencil from '~icons/mdi/pencil-outline'
import IconCheck from '~icons/mdi/check'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconRefresh from '~icons/mdi/refresh'
import IconChevron from '~icons/mdi/chevron-right'
import IconDevices from '~icons/mdi/devices'
import IconLogout from '~icons/mdi/logout'
import IconMessage from '~icons/mdi/message-text-outline'
import AppReveal from '@/components/AppReveal.vue'
import AppScreen from '@/components/AppScreen.vue'
import AppCard from '@/components/AppCard.vue'
import AppButton from '@/components/AppButton.vue'
import RemindersGroup from '@/components/RemindersGroup.vue'
import SalaryShiftGroup from '@/components/SalaryShiftGroup.vue'
import SchemeGroup from '@/components/SchemeGroup.vue'
import SettingsFields from '@/components/SettingsFields.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SignOutSheet from '@/components/SignOutSheet.vue'
import YourDataGroup from '@/components/YourDataGroup.vue'
import { useSettings } from '@/composables/useSettings'
import { useFeedbackSheetStore } from '@/stores/feedbackSheet'
import { useSignOutStore } from '@/stores/signOut'
import { useTripQueueStore } from '@/stores/tripQueue'
import { useVerdictDraftsStore } from '@/stores/verdictDrafts'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
export default defineComponent({
  name: 'SettingsView',
  components: {
    AppButton,
    AppCard,
    AppReveal,
    AppScreen,
    IconAlert,
    IconCheck,
    IconChevron,
    IconCloud,
    IconDevices,
    IconLogout,
    IconMessage,
    IconPencil,
    IconRefresh,
    RemindersGroup,
    SalaryShiftGroup,
    SchemeGroup,
    ScreenSkeleton,
    ScreenState,
    SettingsFields,
    SignOutSheet,
    YourDataGroup,
  },
  setup() {
    const i18n = useI18n()
    const { t } = i18n
    /**
     * The same words the form beside it uses: the notice printed `AM` and `AMD` where the
     * fields say «Армения» and «Армянский драм · AMD», and it is the line a person decides by.
     */
    const saidIn = (value: ActorSettings): Record<string, string> => ({
      country: i18n.te(`settings.countries.${value.country}`)
        ? t(`settings.countries.${value.country}`)
        : value.country,
      city: value.city,
      spendCurrency: t(`settings.currencies.${value.spendCurrency}`),
      incomeCurrency: t(`settings.currencies.${value.incomeCurrency}`),
    })
    const settings = useSettings()

    // «Выйти» (MOL-57): what would be lost is counted while the sheet is open, and the app is
    // asked to send it first — with a connection that is usually everything. Counted is all the
    // erasure takes that the server does not hold (adversarial Б3): the queue, the purchases it
    // refused, every rating draft — a score picked and a review typed, «Сохранить» or not — an
    // unsaved settings form, and the spendings still on the phone or refused (MOL-82, adversarial М).
    const queue = useTripQueueStore()
    const drafts = useVerdictDraftsStore()
    const spendings = useSpendingQueueStore()
    const signOut = useSignOutStore()
    const leaveOpen = ref(false)
    const unsent = computed(
      () =>
        queue.pending.length +
        queue.rejected.length +
        Object.keys(drafts.drafts).length +
        spendings.pending.length +
        spendings.rejected.length +
        (settings.form.dirty ? 1 : 0),
    )
    function askToLeave(): void {
      leaveOpen.value = true
      void queue.flush()
      void drafts.flush()
      void spendings.flush()
    }
    watch(leaveOpen, (open) => {
      if (!open) signOut.stay()
    })

    return {
      t,
      saidIn,
      id: useId(),
      ...settings,
      leaveOpen,
      signOut,
      unsent,
      askToLeave,
      feedback: useFeedbackSheetStore(),
    }
  },
})
</script>
<style scoped lang="scss">
.form,
.actions {
  display: grid;
  gap: var(--space-3);
}

.actions {
  padding: var(--space-3) 0;
}

.note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.offline,
.notice {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3);
  border-radius: var(--radius);
  background: var(--warn-tint);
  color: var(--warn-ink);
  font-size: var(--text-footnote);

  svg {
    @include icon;

    font-size: var(--icon-sm);
  }
}

.offline,
.draft {
  margin-bottom: var(--space-3);
}

.draft {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
}

.pencil {
  display: grid;
  flex: none;
  place-items: center;
  width: var(--space-8);
  height: var(--space-8);
  border-radius: 50%;
  background: var(--warn-tint);
  color: var(--warn-ink);
}

.pencil-icon {
  @include icon;

  font-size: var(--icon-sm);
}

.draft-title,
.message-title {
  margin: 0;
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
}

.message-body {
  margin: var(--space-1) 0 0;
}

.success {
  padding: 0;
  background: transparent;
  color: var(--good-ink);

  svg {
    border-radius: 50%;
    background: var(--good-tint);
  }
}

.error {
  background: var(--bad-tint);
  color: var(--bad-ink);
}

.group {
  margin-top: var(--space-6);
}

.caption {
  margin: 0 0 var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.entry {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--touch-target-lg);
  padding: 0 var(--space-4);
  color: inherit;
  text-decoration: none;

  &:focus-visible {
    @include focus-ring;
  }
}

.entry-icon,
.entry-chevron {
  @include icon;

  color: var(--text-muted);
}

.entry-icon {
  font-size: var(--icon-md);
}

.entry-chevron {
  font-size: var(--icon);
}

.entry-label {
  flex: 1;
}

.entry-text {
  display: grid;
  flex: 1;
  min-width: 0;
  padding: var(--space-2) 0;
}

.entry-hint {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

// A button dressed as the link beside it: the same row. Never `.plain`: that is AppCard's tone on
// its root, which carries this screen's scope as well, and the rule took the card's surface.
.leave,
.opener {
  width: 100%;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

// The colour of an action that ends something (MOL-57).
.leave {
  &,
  .entry-icon {
    color: var(--bad-ink);
  }
}

.skeleton-card {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--surface);
}

.skeleton-field,
.skeleton-label {
  height: var(--touch-target);
  border-radius: var(--radius);
  background: var(--surface-2);
}

.skeleton-label {
  width: 38%;
  height: var(--skeleton-line);
}
</style>
