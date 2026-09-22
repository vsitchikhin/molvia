<template>
  <aside v-if="notice" class="notice">
    <AppCard>
      <ScreenState
        inline
        :kind="notice"
        :tone="tone"
        :title="t(`identity.${notice}.title`)"
        :body="t(`identity.${notice}.body`)"
        @retry="retry"
      />
    </AppCard>
  </aside>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import AppCard from '@/components/AppCard.vue'
import ScreenState from '@/components/ScreenState.vue'
import { useActorStore } from '@/stores/actor'

/**
 * What happened to the identity, when it is something a person has to be told.
 *
 * Two cases, and they are the reason this is not a courtesy: while the identity is not up,
 * every request the app makes goes out without an owner. Showing nothing left a person with an
 * app that looked normal and could not save a thing.
 *
 * **`lost` went with MOL-53.** It said «the trips and ratings of this device are out of reach
 * and we have started a new record; the old key is kept» — a sentence about a world where the
 * device held the key. A session is not the data: losing one means signing in again, and
 * whatever happens then is MOL-56's to draw, together with the screen that can act on it.
 *
 * Drawn by the shared screen state (MOL-19) as a notice of its own height: its cases are that
 * block's cases, not a second implementation of them.
 */
const NOTICES = ['error', 'offline'] as const
type Notice = (typeof NOTICES)[number]

function noticeFor(state: string): Notice | null {
  return (NOTICES as readonly string[]).includes(state) ? (state as Notice) : null
}

export default defineComponent({
  name: 'IdentityNotice',
  components: { AppCard, ScreenState },
  setup() {
    const { t } = useI18n()
    const actor = useActorStore()

    const notice = computed(() => noticeFor(actor.state))
    // Yellow, not the green of an offline trip: without an identity nothing can be saved.
    const tone = computed(() => (notice.value === 'offline' ? ('warn' as const) : undefined))

    return {
      t,
      notice,
      tone,
      retry: () => void actor.retry(),
    }
  },
})
</script>

<style scoped lang="scss">
.notice {
  margin: var(--space-4) var(--space-4) 0;
}
</style>
