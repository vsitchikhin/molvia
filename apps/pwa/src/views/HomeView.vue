<template>
  <section>
    <h2 class="heading">{{ t('home.title') }}</h2>

    <p v-if="state === 'loading'" class="muted">{{ t('state.loading') }}</p>

    <template v-else-if="state === 'offline' || state === 'error'">
      <p class="muted">{{ state === 'offline' ? t('state.offline') : t('state.error') }}</p>
      <button class="button" type="button" @click="load">{{ t('state.retry') }}</button>
    </template>

    <template v-else>
      <p class="muted">{{ t('home.connected', { version }) }}</p>
      <p>{{ t('home.empty') }}</p>
      <button class="button" type="button">{{ t('home.empty_action') }}</button>
    </template>
  </section>
</template>

<script lang="ts">
import { defineComponent, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api'

// Every screen has four states, offline included: the target is a phone at a shelf,
// where the connection drops more often than anything else fails.
type State = 'loading' | 'offline' | 'error' | 'ready'

export default defineComponent({
  name: 'HomeView',
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
.heading {
  margin: 0 0 var(--space-4);
  font-size: 1.5rem;
}

.muted {
  color: var(--text-muted);
}

.button {
  @include touch-target;

  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--surface);
  font: inherit;
  font-weight: 600;
}
</style>
