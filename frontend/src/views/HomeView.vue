<template>
  <AppScreen :title="t('advice.title')">
    <ScreenSkeleton v-if="state === 'loading'" :groups="[40, 78, 62, 78]" />

    <ScreenState
      v-else-if="state === 'error'"
      kind="error"
      :title="t('advice.error.title')"
      :body="t('advice.error.body')"
      @retry="load"
    />

    <!-- No button: the screen reloads by itself when the connection is back. -->
    <ScreenState
      v-else-if="state === 'offline'"
      kind="offline"
      tone="warn"
      :title="t('item.offline.title')"
    />

    <ScreenState
      v-else
      kind="empty"
      tone="accent"
      :icon="IconStar"
      :title="t('advice.empty.title')"
      :body="t('advice.empty.body')"
    >
      <p class="dev">{{ t('dev.connected', { version }) }}</p>
      <template #action>
        <AppButton block>{{ t('advice.empty.action') }}</AppButton>
      </template>
    </ScreenState>
  </AppScreen>
</template>

<script lang="ts">
import { defineComponent, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import IconStar from '~icons/mdi/star-outline'
import { api } from '@/api'
import AppButton from '@/components/AppButton.vue'
import AppScreen from '@/components/AppScreen.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'

// Every screen has four states, offline included: the target is a phone at a shelf,
// where the connection drops more often than anything else fails.
type State = 'loading' | 'offline' | 'error' | 'ready'

// Asked afresh each time, never narrowed: the answer before the request says nothing about
// the connection by the time the request has failed.
function connected(): boolean {
  return navigator.onLine
}

/**
 * Still the scaffold it has been since the repository was set up, now speaking the 0.1
 * dictionary and drawn by the shared state blocks (MOL-19): MOL-32 replaces it with the real
 * «what to buy» screen.
 *
 * Two seams are deliberate. `dev.connected` is a liveness probe rather than product copy —
 * the name says it is temporary, and MOL-32 deletes it with this file. And offline borrows the
 * search's plain «No connection»: the advice's own offline text promises yesterday's data,
 * which this scaffold does not have, and a screen that outlives the sprint is not worth a key
 * of its own (MOL-19, Р-2).
 *
 * Offline or error is decided after the failure, not before the request: a connection that
 * drops while the answer is on its way is the commonest break at a shelf, and it is not red.
 */
export default defineComponent({
  name: 'HomeView',
  components: { AppButton, AppScreen, ScreenSkeleton, ScreenState },
  setup() {
    const { t } = useI18n()
    const state = ref<State>('loading')
    const version = ref('')

    async function load(): Promise<void> {
      if (!connected()) {
        state.value = 'offline'
        return
      }

      state.value = 'loading'
      try {
        version.value = (await api.health()).version
        state.value = 'ready'
      } catch {
        state.value = connected() ? 'error' : 'offline'
      }
    }

    // Back online, the screen tries again by itself — the identity does the same, and a screen
    // left saying «no connection» with the connection back would be lying.
    function reconnect(): void {
      if (state.value === 'offline' || state.value === 'error') void load()
    }

    onMounted(() => {
      window.addEventListener('online', reconnect)
      void load()
    })

    onUnmounted(() => {
      window.removeEventListener('online', reconnect)
    })

    return { t, state, version, load, IconStar }
  },
})
</script>

<style scoped lang="scss">
.dev {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}
</style>
