<template>
  <AppScreen :title="t('advice.title')">
    <p v-if="state === 'loading'" class="muted">{{ t('state.loading') }}</p>

    <template v-else-if="state === 'offline' || state === 'error'">
      <p class="muted">
        {{ state === 'offline' ? t('advice.offline.title') : t('advice.error.title') }}
      </p>
      <button class="button" type="button" @click="load">
        <IconRefresh class="icon" aria-hidden="true" />
        {{ t('state.retry') }}
      </button>
    </template>

    <template v-else>
      <p class="muted">{{ t('dev.connected', { version }) }}</p>
      <p>{{ t('advice.empty.body') }}</p>
      <button class="button" type="button">{{ t('advice.empty.action') }}</button>
    </template>
  </AppScreen>
</template>

<script lang="ts">
import { defineComponent, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import IconRefresh from '~icons/mdi/refresh'
import { api } from '@/api'
import AppScreen from '@/components/AppScreen.vue'

// Every screen has four states, offline included: the target is a phone at a shelf,
// where the connection drops more often than anything else fails.
type State = 'loading' | 'offline' | 'error' | 'ready'

/**
 * Still the scaffold it has been since the repository was set up, now speaking the 0.1
 * dictionary: MOL-32 replaces it with the real «what to buy» screen, and MOL-19 gives every
 * screen the shared four-state block this one only gestures at.
 *
 * Two seams are deliberate. `dev.connected` is a liveness probe rather than product copy —
 * the name says it is temporary, and MOL-32 deletes it with this file. And the offline text
 * here is `advice.offline.*`, which speaks of stale data this scaffold does not actually
 * have; the dictionary is the thing being built, and a screen that outlives the sprint is
 * not worth a key of its own.
 */
export default defineComponent({
  name: 'HomeView',
  components: { AppScreen, IconRefresh },
  setup() {
    const { t } = useI18n()
    const state = ref<State>('loading')
    const version = ref('')

    async function load(): Promise<void> {
      if (!navigator.onLine) {
        state.value = 'offline'
        return
      }

      state.value = 'loading'
      try {
        version.value = (await api.health()).version
        state.value = 'ready'
      } catch {
        state.value = 'error'
      }
    }

    onMounted(() => {
      void load()
    })

    return { t, state, version, load }
  },
})
</script>

<style scoped lang="scss">
.muted {
  color: var(--text-muted);
}

.button {
  @include touch-target;

  gap: var(--space-2);
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius);

  /* --accent is marked non-text use only; a filled control carrying a label takes
     --accent-solid, which is 6.5:1 against --on-accent. */
  background: var(--accent-solid);
  color: var(--on-accent);
  font: inherit;
  font-weight: var(--weight-medium);
}

.icon {
  width: 1.25em;
  height: 1.25em;
}
</style>
