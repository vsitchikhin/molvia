<template>
  <ScreenState
    v-if="consent.state === 'error'"
    kind="error"
    :title="t('consent.failed.title')"
    :body="t('consent.failed.body')"
    @retry="retry"
  />

  <!-- No «Повторить»: the store asks again by itself when the connection is back (MOL-19). -->
  <ScreenState
    v-else-if="consent.state === 'offline'"
    kind="offline"
    tone="warn"
    :title="t('consent.lost.title')"
    :body="t('consent.lost.body')"
  />

  <ScreenState
    v-else
    kind="empty"
    tone="accent"
    :icon="IconShield"
    :title="updated ? t('consent.updated.title') : t('consent.title')"
    :body="updated ? t('consent.updated.body') : t('consent.body')"
  >
    <div class="step">
      <AppCard v-if="changes" class="changes">
        <p class="changes-title">{{ t('consent.updated.changes') }}</p>
        <p class="changes-text">{{ changes }}</p>
      </AppCard>
      <nav class="documents">
        <RouterLink :to="{ name: 'terms' }">
          {{ t('terms.title') }}<IconChevron aria-hidden="true" />
        </RouterLink>
        <RouterLink :to="{ name: 'privacy' }">
          {{ t('privacy.title') }}<IconChevron aria-hidden="true" />
        </RouterLink>
      </nav>
      <label class="age">
        <input v-model="consent.aged" type="checkbox" />
        <span>{{ t('consent.age') }}</span>
      </label>
      <p v-if="!online" class="warn">{{ t('consent.offline') }}</p>
      <!-- Keys written whole: one built from a string is seen by neither the linter nor vue-tsc. -->
      <p v-else-if="consent.failure" class="failed" role="alert">
        {{ consent.failure === 'offline' ? t('consent.offline') : t('consent.error') }}
      </p>
    </div>
    <template #action>
      <AppButton
        block
        :busy="consent.accepting"
        :inactive="!consent.aged || !online"
        @click="accept"
      >
        {{ t('consent.accept') }}
      </AppButton>
      <AppButton block variant="ghost" aria-haspopup="dialog" @click="leaveOpen = true">
        {{ t('consent.decline') }}
      </AppButton>
    </template>
  </ScreenState>

  <BottomSheet v-model:open="leaveOpen" :on-closed="afterLeave">
    <template #title>{{ t('consent.leave.title') }}</template>
    <p class="words">{{ t('consent.leave.body') }}</p>
    <template #footer>
      <div class="ways">
        <AppButton block @click="leaveBy('logout')">{{ t('settings.sign_out') }}</AppButton>
        <AppButton block variant="danger-ghost" @click="leaveBy('erase')">
          {{ t('consent.leave.erase') }}
        </AppButton>
        <AppButton block variant="ghost" @click="leaveOpen = false">
          {{ t('consent.leave.back') }}
        </AppButton>
      </div>
    </template>
  </BottomSheet>

  <SignOutSheet
    v-model:open="signOutOpen"
    :unsent="unsent"
    :busy="signOut.leaving"
    :offline="!online"
    :failure="signOut.logoutFailure"
    @confirm="signOut.leave"
  />
  <EraseSheet
    v-model:open="eraseOpen"
    :busy="signOut.leaving"
    :offline="!online"
    :failure="signOut.eraseFailure"
    @confirm="signOut.leave('erase')"
  />
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconChevron from '~icons/mdi/chevron-right'
import IconShield from '~icons/mdi/shield-check-outline'
import { POLICY_VERSION } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import EraseSheet from '@/components/EraseSheet.vue'
import ScreenState from '@/components/ScreenState.vue'
import SignOutSheet from '@/components/SignOutSheet.vue'
import { useOnline } from '@/composables/useOnline'
import { useConsentStore } from '@/stores/consent'
import { useSignOutStore } from '@/stores/signOut'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import { useTripQueueStore } from '@/stores/tripQueue'
import { useVerdictDraftsStore } from '@/stores/verdictDrafts'

type Way = 'logout' | 'erase'

/**
 * «Условия и приватность» (MOL-95): the step of the login's door after «чей это аккаунт» and before
 * the app, for whoever has not accepted this build's edition — a newcomer, everybody who came before
 * the step existed, and everybody again once the edition is raised.
 *
 * **The age is its own act** (owner's decision В-3): «Принимаю» is inactive until «Мне 16 лет или
 * больше» is ticked, and nothing of the age is sent or kept — the edition accepted says it, its
 * terms name the age.
 *
 * **«Не принимаю» shows the account is already there** (В-4): the bot made it at the login, and an
 * older owner has everything they recorded in it. So the way out is the person's choice of the two
 * there already are — «Выйти» (MOL-57) and «Удалить мои данные» (MOL-94), each with its own sheet,
 * never an erasure on a «no» that a slip of the thumb could cost the owner everything for.
 */
export default defineComponent({
  name: 'ConsentStep',
  components: {
    AppButton,
    AppCard,
    BottomSheet,
    EraseSheet,
    IconChevron,
    ScreenState,
    SignOutSheet,
  },
  setup() {
    const i18n = useI18n()
    const { t } = i18n
    const consent = useConsentStore()
    const online = useOnline()

    // An edition accepted before is the person coming back to a text that changed.
    const updated = computed(() => consent.accepted !== null)
    const changes = computed(() => {
      const key = `consent.changes.${String(POLICY_VERSION)}`
      return updated.value && i18n.te(key) ? t(key) : null
    })

    // The way out is a sheet of its own, opened once this one is put away (`onClosed`).
    const signOut = useSignOutStore()
    const leaveOpen = ref(false)
    const signOutOpen = ref(false)
    const eraseOpen = ref(false)
    let chosen: Way | null = null
    function leaveBy(way: Way): void {
      chosen = way
      leaveOpen.value = false
    }
    function afterLeave(): void {
      const way = chosen
      chosen = null
      if (way === 'logout') signOutOpen.value = true
      if (way === 'erase') eraseOpen.value = true
    }
    watch([signOutOpen, eraseOpen], ([out, erase]) => {
      if (!out && !erase) signOut.stay()
    })

    // What «Выйти» would lose, counted as the settings count it — less the settings form, which is
    // behind this door. An older owner may hold a purchase made at the shelf.
    const queue = useTripQueueStore()
    const drafts = useVerdictDraftsStore()
    const spendings = useSpendingQueueStore()
    const unsent = computed(
      () =>
        queue.pending.length +
        queue.rejected.length +
        Object.keys(drafts.drafts).length +
        spendings.pending.length +
        spendings.rejected.length,
    )

    return {
      t,
      consent,
      online,
      updated,
      changes,
      IconShield,
      accept: () => void consent.accept(),
      retry: () => void consent.retry(),
      signOut,
      leaveOpen,
      signOutOpen,
      eraseOpen,
      leaveBy,
      afterLeave,
      unsent,
    }
  },
})
</script>

<style scoped lang="scss">
.step {
  display: grid;
  gap: var(--space-4);
  text-align: left;
}

.changes-title {
  margin: 0;
  font-weight: var(--weight-medium);
}

.changes-text {
  margin: var(--space-1) 0 0;
  color: var(--text-muted);
  font-size: var(--text-callout);
}

.documents {
  display: grid;

  a {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: var(--touch-target);
    color: var(--accent-ink);
    text-decoration: none;
  }

  svg {
    @include icon;

    font-size: var(--icon);
  }
}

.age {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--touch-target);
  padding: var(--space-2) var(--space-3);
  border: var(--hairline) solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;

  input {
    flex: none;
    width: var(--space-6);
    height: var(--space-6);
    margin: 0;
    accent-color: var(--accent-solid);
  }
}

.warn,
.failed {
  margin: 0;
  font-size: var(--text-footnote);
}

.warn {
  color: var(--warn-ink);
}

.failed {
  color: var(--bad-ink);
}

.words {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-callout);
  line-height: var(--leading-body);
}

.ways {
  display: grid;
  gap: var(--space-2);
}
</style>
