<template>
  <AppScreen :title="t('settings.title')">
    <!-- The form's shape (Ф-13): its two groups, each field its label, its well and its hint — the
         country has none — and the footnote under them. -->
    <ScreenSkeleton v-if="form.loading && !form.draft">
      <SkeletonPart kind="caption" :width="28" />
      <div class="ghost-card">
        <div class="ghost-group">
          <span class="ghost-label"></span><span class="ghost-field"></span>
        </div>
        <div class="ghost-group">
          <span class="ghost-label"></span><span class="ghost-field"></span>
          <span class="ghost-label hint"></span>
        </div>
      </div>
      <SkeletonPart kind="caption" :width="20" />
      <div class="ghost-card">
        <div v-for="at in 2" :key="at" class="ghost-group">
          <span class="ghost-label"></span><span class="ghost-field"></span>
          <span class="ghost-label hint"></span>
        </div>
      </div>
      <!-- The form's footnote, two lines at 390 (review 1 №2). -->
      <SkeletonPart kind="lines" :card="false" :widths="[92]" />
    </ScreenSkeleton>
    <ScreenState
      v-else-if="!form.draft && !online"
      kind="offline"
      tone="warn"
      :title="t('settings.offline.title')"
      :body="t('settings.offline.body')"
    />
    <ScreenState
      v-else-if="
        !form.draft && online && form.failure === 'error' && !form.unknown && !form.saveError
      "
      kind="error"
      :title="t('settings.load_error.title')"
      :body="t('settings.load_error.body')"
      @retry="form.refresh"
    />
    <template v-if="form.draft">
      <!-- A form shown from what the phone remembers says as of when, and what became of the read
           (MOL-215, Е-8): the strip, never the quiet card over the fields being edited (MOL-181). -->
      <StatusStrip
        v-if="strip"
        class="status"
        :kind="strip.kind"
        :text="strip.text"
        :attempt="form.failures"
      >
        <template #action>
          <AppButton variant="ghost" @click="form.refresh(true)">{{ t('state.retry') }}</AppButton>
        </template>
      </StatusStrip>
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
         are also a trip's context (MOL-134, Н-1, В-5). The groups are mounted under the skeleton, so
         their reads go at once, and hidden while the form's skeleton stands (MOL-269): the form coming
         in its place moved them from under the finger. -->
    <SalaryShiftGroup v-show="groupsShown" class="group" />
    <!-- The bot's messages, a switch each, on a page of their own (MOL-129, В-2). -->
    <section v-show="groupsShown" class="group">
      <SectionCaption>{{ t('settings.group_bot') }}</SectionCaption>
      <AppCard as="ul" list>
        <li>
          <ListRow
            as="router-link"
            :to="{ name: 'bot' }"
            :icon="IconRobot"
            :title="t('bot.title')"
            :meta="t('settings.bot.hint')"
            next
          />
        </li>
      </AppCard>
    </section>
    <!-- This device's own, not the account's: nothing goes to the server (MOL-111). -->
    <SchemeGroup v-show="groupsShown" class="group" />
    <!-- Outside the form's states: the way into the account does not depend on whether its
         settings loaded (MOL-57) — only on the skeleton having gone, answer or failure (MOL-269).
         One group (owner's Q3) and two cards: «Устройства» goes on to a screen and «Выйти» asks to
         confirm, and one card never holds both (В-14 «а»; MOL-215, owner's В-1 «а»). -->
    <section v-show="groupsShown" class="group">
      <SectionCaption>{{ t('settings.group_account') }}</SectionCaption>
      <AppCard as="ul" list>
        <li>
          <NavRow :to="{ name: 'devices' }" :icon="IconDevices" :label="t('devices.title')" />
        </li>
      </AppCard>
      <!-- Here and not beside «Это устройство» in the list: leaving a laptop that is not yours
           is «quickly, then go», and it is looked for on this screen (owner's decision Q3). -->
      <AppCard as="ul" list class="second">
        <li>
          <ListRow
            class="leave"
            :icon="IconLogout"
            :title="t('settings.sign_out')"
            danger
            @click="askToLeave"
          />
        </li>
      </AppCard>
    </section>
    <!-- «Написать разработчику» (MOL-147): a sheet with fields, so the chevron of В-14 (Р-3 of
         MOL-175). Offline it opens all the same: written now, sent once there is a connection. -->
    <section v-show="groupsShown" class="group">
      <SectionCaption>{{ t('settings.group_app') }}</SectionCaption>
      <AppCard as="ul" list>
        <li>
          <ListRow
            :icon="IconMessage"
            :title="t('settings.feedback.label')"
            :meta="t('settings.feedback.hint')"
            aria-haspopup="dialog"
            next
            @click="feedback.open({ from: 'settings' })"
          />
        </li>
      </AppCard>
    </section>
    <YourDataGroup v-show="groupsShown" />
    <SignOutSheet
      v-model:open="leaveOpen"
      :unsent="unsent"
      :busy="signOut.leaving"
      :offline="!online"
      :failure="signOut.logoutFailure"
      @confirm="signOut.leave"
    />
    <template #docked>
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
      <AppButton
        block
        :inactive="!online || !form.dirty || form.loading || form.unknown"
        :busy="form.saving"
        :busy-label="t('settings.saving')"
        :aria-describedby="notice ? `${id}-notice` : undefined"
        @click="form.save"
      >
        <template v-if="form.saveError && online && !form.saving && !form.loading" #icon
          ><IconRefresh
        /></template>
        {{ saveWord }}
      </AppButton>
    </template>
  </AppScreen>
</template>
<script lang="ts">
import { computed, defineComponent, onUnmounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ActorSettings } from '@molvia/model'
import IconCloud from '~icons/mdi/cloud-off-outline'
import IconPencil from '~icons/mdi/pencil-outline'
import IconCheck from '~icons/mdi/check'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconRefresh from '~icons/mdi/refresh'
import IconDevices from '~icons/mdi/devices'
import IconRobot from '~icons/mdi/robot-outline'
import IconLogout from '~icons/mdi/logout'
import IconMessage from '~icons/mdi/message-text-outline'
import AppReveal from '@/components/AppReveal.vue'
import AppScreen from '@/components/AppScreen.vue'
import AppCard from '@/components/AppCard.vue'
import AppButton from '@/components/AppButton.vue'
import ListRow from '@/components/ListRow.vue'
import NavRow from '@/components/NavRow.vue'
import SalaryShiftGroup from '@/components/SalaryShiftGroup.vue'
import SchemeGroup from '@/components/SchemeGroup.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import SettingsFields from '@/components/SettingsFields.vue'
import { countryLabel } from '@/components/placeLabel'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import SkeletonPart from '@/components/SkeletonPart.vue'
import ScreenState from '@/components/ScreenState.vue'
import SignOutSheet from '@/components/SignOutSheet.vue'
import StatusStrip, { STRIP_LATE_MS } from '@/components/StatusStrip.vue'
import type { StripKind } from '@/components/StatusStrip.vue'
import YourDataGroup from '@/components/YourDataGroup.vue'
import { useSettings } from '@/composables/useSettings'
import { useLocalDay } from '@/composables/useLocalDay'
import { answeredAt } from '@/days'
import { useActorStore } from '@/stores/actor'
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
    IconCloud,
    IconPencil,
    IconRefresh,
    ListRow,
    NavRow,
    SalaryShiftGroup,
    SchemeGroup,
    ScreenSkeleton,
    ScreenState,
    SkeletonPart,
    SectionCaption,
    SettingsFields,
    SignOutSheet,
    StatusStrip,
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
      country: countryLabel(value.country, i18n),
      city: value.city,
      spendCurrency: t(`settings.currencies.${value.spendCurrency}`),
      incomeCurrency: t(`settings.currencies.${value.incomeCurrency}`),
    })
    const settings = useSettings()
    const { form, online } = settings
    const actor = useActorStore()

    /**
     * A read on its way for longer than a moment: only then does the strip say so — a quick one
     * replaces the form in silence (MOL-201), and the read goes at every opening of the screen.
     */
    const late = ref(false)
    let lateTimer: ReturnType<typeof setTimeout> | undefined
    watch(
      () => form.loading && !!form.draft,
      (waiting) => {
        clearTimeout(lateTimer)
        late.value = false
        if (waiting) {
          lateTimer = setTimeout(() => {
            late.value = true
          }, STRIP_LATE_MS)
        }
      },
      { immediate: true },
    )
    onUnmounted(() => {
      clearTimeout(lateTimer)
    })

    /**
     * The form shown and what the server can say of it now (MOL-215, С-11, С-12), as of when the
     * server last said it to this phone — a shelf of the build before keeps no time, and then the
     * words say «из памяти». A failure of a save speaks in the strip of the button instead. The day is
     * the screen's (`answeredAt`, MOL-187 А2): an app left overnight said «сегодня» of yesterday's
     * answer the next morning (adversarial А1).
     */
    const today = useLocalDay()
    const strip = computed<{ kind: StripKind; text: string } | null>(() => {
      if (!form.draft) return null
      const at = actor.settingsReadAt
      const said = (key: string): string =>
        at ? t(key, { when: answeredAt(at, i18n.locale.value, today.value) }) : t(`${key}_untimed`)
      if (!online.value) return { kind: 'offline', text: said('settings.offline.strip') }
      if (form.failure === 'error' && !form.unknown && !(form.saveError && form.failureOfSave))
        return { kind: 'unanswered', text: said('settings.stale_error') }
      if (late.value) return { kind: 'refreshing', text: said('settings.stale_loading') }
      return null
    })

    /**
     * The button says why it cannot be pressed (Ф-6), on itself and not in a line over it. «Загружаем…»
     * only where the read keeps the save back: an unchanged form says «изменений нет» while the read of
     * every opening is on its way, or the word would blink at each one.
     */
    const saveWord = computed(() => {
      // Not while the read after the refusal is on its way: that keeps it back (adversarial А3).
      if (form.saveError && online.value && !form.loading) return t('state.retry')
      if (!online.value) return t('settings.save_needs_network')
      if (form.unknown) return t('settings.save')
      if (!form.draft) return t('state.loading')
      if (!form.dirty) return t('settings.save_unchanged')
      if (form.loading) return t('state.loading')
      return form.conflict ? t('settings.overwrite') : t('settings.save')
    })

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

    // Never under the form's skeleton (MOL-269), on the first read or one after a failure — «Повторить»,
    // the connection back, the app back in view all read with the failure still standing, and the
    // skeleton is the one condition both share (review Р3-1). Not the salary's day: nothing of it is
    // kept on the phone, so waiting for it hid the groups at every opening, and a step back the browser
    // showed whole came in again under its picture.
    const groupsShown = computed(() => !(settings.form.loading && !settings.form.draft))

    return {
      t,
      saidIn,
      id: useId(),
      ...settings,
      leaveOpen,
      signOut,
      unsent,
      askToLeave,
      groupsShown,
      strip,
      saveWord,
      IconDevices,
      IconLogout,
      IconMessage,
      IconRobot,
      feedback: useFeedbackSheetStore(),
    }
  },
})
</script>
<style scoped lang="scss">
.form {
  display: grid;
  gap: var(--space-3);
}

.note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

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

.status,
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

// The second card of a group, as close to the first as a caption is to its card.
.second {
  margin-top: var(--space-2);
}

.ghost-card {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--surface);
}

/* A field of the form, empty: its well and its edge, which `surface-2` alone on a card is not seen by
   (1.1:1, Ф-13) — 44 inside the edge, 46 outside, as `AppField` (adversarial А6). `ghost-*`, never
   `skeleton-*`: those are the roots of the kit's parts, and a scoped class of this screen would reach
   one put in the frame's slot (adversarial Б1). */
.ghost-field {
  box-sizing: border-box;
  height: calc(var(--touch-target) + 2 * var(--hairline));
  border: var(--hairline) solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface-2);
}

.ghost-group {
  display: grid;
  gap: var(--space-2);
}

.ghost-label {
  @include skeleton-bar;

  width: 38%;
  height: var(--skeleton-line);

  &.hint {
    width: 72%;
  }
}
</style>
