<template>
  <RouterView />
  <TabBar v-if="route.meta.tab" />
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useRoute } from 'vue-router'
import TabBar from '@/components/TabBar.vue'

// No header of its own: no mockup carries the brand, every screen is titled by its section,
// and the frame around each screen is AppScreen's.
export default defineComponent({
  name: 'AppRoot',
  components: { TabBar },
  setup() {
    return { route: useRoute() }
  },
})
</script>
