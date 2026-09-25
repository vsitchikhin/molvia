<template>
  <AppScreen :title="t('devices.title')">
    <ScreenSkeleton v-if="phase === 'loading'" :groups="[56, 72, 64]" />

    <ScreenState
      v-else-if="phase === 'error'"
      kind="error"
      :title="t('devices.load_error.title')"
      :body="t('devices.load_error.body')"
      @retry="retry"
    />

    <!-- No button and no remembered list: yesterday's keys to the account read as today's would
         hide the very device a person came to end. The screen loads by itself when back online. -->
    <ScreenState
      v-else-if="phase === 'offline'"
      kind="offline"
      tone="warn"
      :title="t('devices.offline.title')"
      :body="t('devices.offline.body')"
    />

    <section v-else-if="list" class="list">
      <h2 ref="caption" class="caption" tabindex="-1">{{ t('devices.list_title') }}</h2>
      <AppCard as="ul" list>
        <li v-for="session in list.sessions" :key="session.id" class="row">
          <component :is="iconOf(session.deviceName)" class="icon" aria-hidden="true" />
          <div class="body">
            <p class="name">
              {{ nameOf(session) }}
              <span v-if="session.current" class="this">{{ t('devices.this_device') }}</span>
            </p>
            <p class="meta">{{ metaOf(session) }}</p>
          </div>
          <AppButton
            v-if="!session.current"
            variant="danger-ghost"
            :aria-label="said('devices.end_label', session.deviceName)"
            @click="ask(session)"
          >
            {{ t('devices.end') }}
          </AppButton>
        </li>
      </AppCard>
      <p v-if="list.total > list.sessions.length" class="note">
        {{ t('devices.more', { shown: list.sessions.length, total: list.total }) }}
      </p>
      <p class="note">{{ t('devices.note') }}</p>
    </section>

    <SessionEndSheet
      v-model:open="sheetOpen"
      :device="target?.deviceName ?? null"
      :busy="ending !== null"
      :failed="endFailed"
      @confirm="confirm"
    />
  </AppScreen>
</template>

<script lang="ts">
import { defineComponent, nextTick, onUnmounted, ref, watch } from 'vue'
import type { Component } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SessionView } from '@molvia/model'
import IconCellphone from '~icons/mdi/cellphone'
import IconDevices from '~icons/mdi/devices'
import IconLaptop from '~icons/mdi/laptop'
import IconTablet from '~icons/mdi/tablet'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppScreen from '@/components/AppScreen.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SessionEndSheet from '@/components/SessionEndSheet.vue'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useSessions } from '@/composables/useSessions'
import { dayOfAnyYear } from '@/days'

/**
 * «Устройства» (MOL-57), under «Настройки»: every live way into the account, this one first and
 * marked, and «Завершить» on the rest. This one has no button — «Выйти» is its own row in the
 * settings (owner's decision Q3), one place for one action.
 *
 * «Были» is a day, never a time: `last_seen_at` moves at most once a day (MOL-53), so a clock
 * beside it would claim a precision the row does not have. The current row says no «были» at
 * all — it is now.
 */
export default defineComponent({
  name: 'DevicesView',
  components: { AppButton, AppCard, AppScreen, ScreenSkeleton, ScreenState, SessionEndSheet },
  setup() {
    const { t, locale } = useI18n()
    const sessions = useSessions()
    const sheetOpen = ref(false)
    const target = ref<SessionView | null>(null)

    function ask(session: SessionView): void {
      target.value = session
      sessions.endFailed.value = false
      sheetOpen.value = true
    }

    // The button that opened the sheet goes with its row, so the focus has nowhere to return:
    // it goes to the heading of the list, and what happened is said out loud.
    const caption = ref<HTMLElement | null>(null)
    const announce = useAnnouncer()
    let unsay: (() => void) | undefined
    onUnmounted(() => unsay?.())

    async function confirm(): Promise<void> {
      const session = target.value
      if (!session) return
      const device = session.deviceName
      if (!(await sessions.end(session))) return
      sheetOpen.value = false
      unsay?.()
      unsay = announce?.(said('devices.ended', device))
      await nextTick()
      caption.value?.focus()
    }
    // A sheet closed by the person clears what it said about the last attempt.
    watch(sheetOpen, (open) => {
      if (!open) sessions.endFailed.value = false
    })

    const dayOf = (when: Date): string => dayOfAnyYear(when, locale.value)
    const nameOf = (session: SessionView): string => session.deviceName ?? t('devices.unknown')
    // «на Неизвестное устройство» is the name put into a sentence as it is; an unknown device gets
    // a sentence of its own, with the words in their case (self-review С-4).
    const said = (key: string, device: string | null): string =>
      device === null ? t(`${key}_unknown`) : t(key, { device })
    const metaOf = (session: SessionView): string =>
      session.current
        ? t('devices.meta_current', { signedIn: dayOf(session.createdAt) })
        : t('devices.meta', { signedIn: dayOf(session.createdAt), seen: dayOf(session.lastSeenAt) })

    /** A picture for the name the server derived — presentation only, never a claim. */
    function iconOf(name: string | null): Component {
      if (name === null) return IconDevices
      if (name.startsWith('iPhone') || name.startsWith('Android')) return IconCellphone
      if (name.startsWith('iPad')) return IconTablet
      if (/^(?:Windows|Mac|Linux)\b/.test(name)) return IconLaptop
      return IconDevices
    }

    return {
      t,
      ...sessions,
      sheetOpen,
      target,
      caption,
      ask,
      confirm,
      nameOf,
      said,
      metaOf,
      iconOf,
    }
  },
})
</script>

<style scoped lang="scss">
.caption {
  margin: 0 0 var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;

  &:focus-visible {
    @include focus-ring;
  }
}

.row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
}

.icon {
  flex: none;
  width: var(--space-6);
  height: var(--space-6);
  color: var(--text-muted);
}

.body {
  flex: 1;
  min-width: 0;
}

.name,
.meta {
  margin: 0;
  overflow-wrap: anywhere;
}

.name {
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
}

.this {
  display: inline-block;
  margin-left: var(--space-2);
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--good-tint);
  color: var(--good-ink);
  font-size: var(--text-caption);
  font-weight: var(--weight-medium);
}

.meta,
.note {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.meta {
  margin-top: var(--space-1);
}

.note {
  margin: var(--space-4) 0 0;
}
</style>
