<template>
  <aside v-if="notice && !dismissed" class="notice" :class="tone" :role="role">
    <h2 class="title">{{ t(`identity.${notice}_title`) }}</h2>
    <p class="body">{{ t(`identity.${notice}_body`) }}</p>
    <p v-if="restoreFailed" class="body failed">{{ t('identity.lost_restore_failed') }}</p>

    <div class="actions">
      <button v-if="canRetry" class="action" type="button" @click="retry">
        <IconRefresh class="icon" aria-hidden="true" />
        {{ t('state.retry') }}
      </button>
      <button v-if="canRestore" class="action" type="button" @click="restore">
        {{ t('identity.lost_restore') }}
      </button>
      <button v-if="notice === 'lost'" class="action" type="button" @click="dismissed = true">
        {{ t('identity.lost_action') }}
      </button>
    </div>
  </aside>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconRefresh from '~icons/mdi/refresh'
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
 * MOL-19 builds the shared set of four states; these become its cases rather than a second
 * implementation of them.
 */
const NOTICES = ['lost', 'uninvited', 'error', 'offline'] as const
type Notice = (typeof NOTICES)[number]

function noticeFor(state: string): Notice | null {
  return (NOTICES as readonly string[]).includes(state) ? (state as Notice) : null
}

export default defineComponent({
  name: 'IdentityNotice',
  components: { IconRefresh },
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
    const tone = computed(() => (canRetry.value ? 'plain' : 'warn'))
    // Losing an identity interrupts what someone was doing; a dropped connection does not.
    const role = computed(() => (canRetry.value ? 'status' : 'alert'))

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
      tone,
      role,
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
  padding: var(--space-4);
  border: var(--hairline) solid;
  border-radius: var(--radius);
}

/* Something a person has to act on — a lost identity, a link that does not work. */
.warn {
  border-color: var(--warn);
  background: var(--warn-tint);
  color: var(--warn-ink);
}

/* Something that may pass on its own: no connection, a server that did not answer. */
.plain {
  border-color: var(--border);
  background: var(--surface);
  color: var(--text);
}

.title {
  margin: 0 0 var(--space-2);
  font-family: var(--font-display);
  font-size: var(--text-headline);
  font-weight: var(--weight-bold);
  line-height: var(--leading-snug);
}

.body {
  margin: 0;
  font-size: var(--text-callout);
  line-height: var(--leading-body);
}

.failed {
  margin-top: var(--space-2);
  font-weight: var(--weight-medium);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

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
