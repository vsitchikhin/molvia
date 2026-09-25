<template>
  <!-- The app's polite live region: states hand their words here rather than carry a role. -->
  <div class="announcer" role="status">
    <p v-for="announcement in announcements" :key="announcement.id">{{ announcement.text }}</p>
  </div>
  <!-- Всё приложение — за входом (MOL-56). Экран входа не маршрут: адрес всё это время тот,
       куда человек шёл, и после входа он там и оказывается. -->
  <LoginView v-if="closed" />
  <template v-else>
    <RouterView />
    <TabBar v-if="route.meta.tab" />
  </template>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import TabBar from '@/components/TabBar.vue'
import LoginView from '@/views/LoginView.vue'
import { provideAnnouncer } from '@/composables/useAnnouncer'
import { useReconnect } from '@/composables/useReconnect'
import { useLoginStore } from '@/stores/login'
import { useTripQueueStore } from '@/stores/tripQueue'
import { useVerdictDraftsStore } from '@/stores/verdictDrafts'

// No header of its own: no mockup carries the brand, every screen is titled by its section,
// and the frame around each screen is AppScreen's.
export default defineComponent({
  name: 'AppRoot',
  components: { LoginView, TabBar },
  setup() {
    const login = useLoginStore()

    // Whether the app is shown at all, or the login screen instead. The rule lives in the login
    // store, where it can be read and tested without mounting the app (MOL-56).
    const closed = computed(() => login.closed)

    // The app, not a screen, sends what waits on the phone, whichever screen is open when the
    // connection is back: purchases written at the shelf (MOL-24) and saved ratings (MOL-28).
    // Not while the door is shut — though the queue has a second way out of its own, on a change
    // of owner, and that one is not held here: it sends the drawer of whoever the server says we
    // are, and a stranger's drawer on this device is empty.
    const queue = useTripQueueStore()
    const drafts = useVerdictDraftsStore()
    const send = () => {
      if (closed.value) return
      void queue.flush()
      void drafts.flush()
    }
    onMounted(send)
    useReconnect(send)
    // A door that has just opened is the other moment worth sending: what the queue held on a
    // `401` has been waiting for exactly this (MOL-24, `HOLDS`).
    watch(closed, (shut) => {
      if (!shut) send()
    })

    return { closed, route: useRoute(), announcements: provideAnnouncer() }
  },
})
</script>

<style scoped lang="scss">
.announcer {
  @include visually-hidden;
}
</style>
