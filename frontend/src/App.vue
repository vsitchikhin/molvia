<template>
  <!-- The app's polite live region: states hand their words here rather than carry a role. -->
  <div class="announcer" role="status">
    <p v-for="announcement in announcements" :key="announcement.id">{{ announcement.text }}</p>
  </div>
  <RouterView />
  <TabBar v-if="route.meta.tab" />
</template>

<script lang="ts">
import { defineComponent, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import TabBar from '@/components/TabBar.vue'
import { provideAnnouncer } from '@/composables/useAnnouncer'
import { useReconnect } from '@/composables/useReconnect'
import { useTripQueueStore } from '@/stores/tripQueue'
import { useVerdictDraftsStore } from '@/stores/verdictDrafts'

// No header of its own: no mockup carries the brand, every screen is titled by its section,
// and the frame around each screen is AppScreen's.
export default defineComponent({
  name: 'AppRoot',
  components: { TabBar },
  setup() {
    // The app, not a screen, sends what waits on the phone, whichever screen is open when the
    // connection is back: purchases written at the shelf (MOL-24) and saved ratings (MOL-28).
    const queue = useTripQueueStore()
    const drafts = useVerdictDraftsStore()
    const send = () => {
      void queue.flush()
      void drafts.flush()
    }
    onMounted(send)
    useReconnect(send)

    return { route: useRoute(), announcements: provideAnnouncer() }
  },
})
</script>

<style scoped lang="scss">
.announcer {
  @include visually-hidden;
}
</style>
