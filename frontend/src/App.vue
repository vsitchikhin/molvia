<template>
  <!-- The app's polite live region: states hand their words here rather than carry a role. -->
  <div class="announcer" role="status">
    <p v-for="announcement in announcements" :key="announcement.id">{{ announcement.text }}</p>
  </div>
  <RouterView />
  <TabBar v-if="route.meta.tab" />
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useRoute } from 'vue-router'
import TabBar from '@/components/TabBar.vue'
import { provideAnnouncer } from '@/composables/useAnnouncer'

// No header of its own: no mockup carries the brand, every screen is titled by its section,
// and the frame around each screen is AppScreen's.
export default defineComponent({
  name: 'AppRoot',
  components: { TabBar },
  setup() {
    return { route: useRoute(), announcements: provideAnnouncer() }
  },
})
</script>

<style scoped lang="scss">
.announcer {
  @include visually-hidden;
}
</style>
