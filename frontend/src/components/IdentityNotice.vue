<template>
  <ScreenState
    v-if="notice && !dismissed"
    class="notice"
    inline
    :kind="kind"
    :tone="tone"
    :title="t(`identity.${notice}.title`)"
    :body="t(`identity.${notice}.body`)"
  >
    <template v-if="restoreFailed" #default>
      <p class="failed">{{ t('identity.restore_failed') }}</p>
    </template>

    <template v-if="canRetry || canRestore || notice === 'lost'" #action>
      <button v-if="canRetry" class="action" type="button" @click="retry">
        <IconRefresh class="icon" aria-hidden="true" />
        {{ t('state.retry') }}
      </button>
      <button v-if="canRestore" class="action" type="button" @click="restore">
        {{ t('identity.restore') }}
      </button>
      <button v-if="notice === 'lost'" class="action" type="button" @click="dismissed = true">
        {{ t('identity.action') }}
      </button>
    </template>
  </ScreenState>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconRefresh from '~icons/mdi/refresh'
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
const NOTICES = ['lost', 'uninvited', 'error', 'offline'] as const
type Notice = (typeof NOTICES)[number]

function noticeFor(state: string): Notice | null {
  return (NOTICES as readonly string[]).includes(state) ? (state as Notice) : null
}

export default defineComponent({
  name: 'IdentityNotice',
  components: { IconRefresh, ScreenState },
  setup() {
    const { t } = useI18n()
    const actor = useActorStore()
    const dismissed = ref(false)

    const notice = computed(() => noticeFor(actor.state))
    // Retrying is only useful where the app might succeed next time. «Uninvited» needs a
    // different link, not another attempt, and a button there would promise otherwise.
    const canRetry = computed(() => notice.value === 'error' || notice.value === 'offline')
    // Read from a ref rather than by asking storage: a list that changed while the state
    // stayed `lost` — which is exactly what a failed restore does — left the button showing
    // a stale answer (М-23).
    const canRestore = computed(() => notice.value === 'lost' && actor.lost.length > 0)
    // A lost identity and a missing invite are neither an error of the screen nor offline:
    // something the person has to know. The screen state gives each its tone and its role.
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
      canRetry,
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

/* Until AppButton (MOL-18) is on master: then these become its primary and ghost. */
.action {
  @include touch-target;

  gap: var(--space-2);
  padding: 0 var(--space-4);
  border: var(--hairline) solid currentcolor;
  border-radius: var(--radius);
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: var(--weight-medium);
}

.icon {
  width: 1.25em;
  height: 1.25em;
}
</style>
