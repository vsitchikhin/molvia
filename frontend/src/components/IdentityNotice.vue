<template>
  <aside v-if="notice && !dismissed" class="notice">
    <AppCard>
      <ScreenState
        inline
        :kind="kind"
        :tone="tone"
        :title="t(`identity.${notice}.title`)"
        :body="t(`identity.${notice}.body`)"
        @retry="retry"
      >
        <template v-if="restoreFailed" #default>
          <p class="failed">{{ t('identity.restore_failed') }}</p>
        </template>

        <!-- An error brings its own «Try again». Offline has none: the store comes back by itself
           on `online`, as the text promises, and a second «Try again» under the screen's own
           would do something else under the same name (MOL-19, Р-1). -->
        <template v-if="notice === 'lost'" #action>
          <AppButton v-if="canRestore" block @click="restore">
            {{ t('identity.restore') }}
          </AppButton>
          <AppButton variant="ghost" block @click="dismissed = true">
            {{ t('identity.action') }}
          </AppButton>
        </template>
      </ScreenState>
    </AppCard>
  </aside>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import ScreenState from '@/components/ScreenState.vue'
import { useActorStore } from '@/stores/actor'

/**
 * What happened to the identity, when it is something a person has to be told. Losing the
 * stored identifier means the trips and ratings of this device are out of reach, and an app
 * that quietly reappeared empty would look broken rather than honest — the owner chose this
 * over silence when the plan was reviewed (MOL-8, В-7).
 *
 * `error` and `offline` are here too, and they are the reason this is not a courtesy: while
 * the identity is not up, every request the app makes goes out without an owner. Showing
 * nothing left a person with an app that looked normal and could not save a thing.
 *
 * Drawn by the shared screen state (MOL-19) as a notice of its own height: its four cases are
 * that block's cases, not a second implementation of them.
 */
const NOTICES = ['lost', 'error', 'offline'] as const
type Notice = (typeof NOTICES)[number]

function noticeFor(state: string): Notice | null {
  return (NOTICES as readonly string[]).includes(state) ? (state as Notice) : null
}

export default defineComponent({
  name: 'IdentityNotice',
  components: { AppButton, AppCard, ScreenState },
  setup() {
    const { t } = useI18n()
    const actor = useActorStore()
    const dismissed = ref(false)

    const notice = computed(() => noticeFor(actor.state))
    // Read from a ref rather than by asking storage: a list that changed while the state
    // stayed `lost` — which is exactly what a failed restore does — left the button showing
    // a stale answer (М-23).
    const canRestore = computed(() => notice.value === 'lost' && actor.lost.length > 0)
    // A lost identity is neither an error of the screen nor offline: something the person has
    // to know, with no «Try again» — a retry restores nothing by itself. The screen state
    // gives each case its tone, its role, its retry.
    const kind = computed(() => {
      if (notice.value === 'error' || notice.value === 'offline') return notice.value
      return 'attention' as const
    })
    // Yellow, not the green of an offline trip: without an identity nothing can be saved.
    const tone = computed(() => (notice.value === 'offline' ? ('warn' as const) : undefined))

    // A message dismissed for one situation must not hide the next one.
    watch(notice, () => {
      dismissed.value = false
    })

    return {
      t,
      notice,
      dismissed,
      canRestore,
      kind,
      tone,
      restoreFailed: computed(() => actor.restoreFailed),
      retry: () => void actor.retry(),
      restore: () => void actor.restore(),
    }
  },
})
</script>

<style scoped lang="scss">
.notice {
  margin: var(--space-4) var(--space-4) 0;
}

.failed {
  margin: 0;
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}
</style>
