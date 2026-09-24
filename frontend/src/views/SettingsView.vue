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
      <AppCard
        v-if="form.dirty && !form.unknown && (form.returned || form.conflict || !form.stored)"
        class="draft"
      >
        <IconPencil class="pencil" aria-hidden="true" />
        <div>
          <p class="draft-title">{{ t('settings.draft.title') }}</p>
          <p v-if="!form.stored" class="note">{{ t('settings.draft.volatile') }}</p>
          <AppButton variant="ghost" :inactive="form.saving" @click="form.cancel">{{
            t('settings.cancel')
          }}</AppButton>
        </div>
      </AppCard>
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
    <AppButton class="privacy" variant="ghost" block @click="privacy">{{
      t('privacy.title')
    }}</AppButton>
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
import { defineComponent, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { ActorSettings } from '@molvia/model'
import IconCloud from '~icons/mdi/cloud-off-outline'
import IconPencil from '~icons/mdi/pencil-outline'
import IconCheck from '~icons/mdi/check'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconRefresh from '~icons/mdi/refresh'
import AppScreen from '@/components/AppScreen.vue'
import AppCard from '@/components/AppCard.vue'
import AppButton from '@/components/AppButton.vue'
import SettingsFields from '@/components/SettingsFields.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import { useSettings } from '@/composables/useSettings'
export default defineComponent({
  name: 'SettingsView',
  components: {
    AppScreen,
    AppCard,
    AppButton,
    SettingsFields,
    ScreenSkeleton,
    ScreenState,
    IconCloud,
    IconPencil,
    IconCheck,
    IconAlert,
    IconRefresh,
  },
  setup() {
    const { t } = useI18n()
    const router = useRouter()
    /**
     * The same words the form beside it uses: the notice printed `AM` and `AMD` where the
     * fields say «Армения» and «Армянский драм · AMD», and it is the line a person decides by.
     */
    const saidIn = (value: ActorSettings): Record<string, string> => ({
      country: value.country === 'AM' ? t('settings.armenia') : value.country,
      city: value.city,
      spendCurrency: t(`settings.currencies.${value.spendCurrency}`),
      incomeCurrency: t(`settings.currencies.${value.incomeCurrency}`),
    })
    return {
      t,
      saidIn,
      id: useId(),
      privacy: () => void router.push({ name: 'privacy' }),
      ...useSettings(),
    }
  },
})
</script>
<style scoped lang="scss">
.privacy {
  margin-top: var(--space-6);
}

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
    flex: none;
    width: var(--space-6);
    height: var(--space-6);
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
  flex: none;
  width: var(--space-8);
  height: var(--space-8);
  padding: var(--space-2);
  border-radius: 50%;
  background: var(--warn-tint);
  color: var(--warn-ink);
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
