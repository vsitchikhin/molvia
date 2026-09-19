<template>
  <IdentityNotice />
  <main class="main" :class="{ tabbed: Boolean(route.meta.tab) }">
    <RouterView />
  </main>
  <TabBar v-if="route.meta.tab" />
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useRoute } from 'vue-router'
import IdentityNotice from '@/components/IdentityNotice.vue'
import TabBar from '@/components/TabBar.vue'

// No header of its own: no mockup carries the brand, every screen is titled by its section.
export default defineComponent({
  name: 'AppRoot',
  components: { IdentityNotice, TabBar },
  setup() {
    return { route: useRoute() }
  },
})
</script>

<style scoped lang="scss">
.main {
  padding: var(--space-4);
}

.tabbed {
  padding-bottom: calc(var(--tabbar-height) + var(--safe-bottom) + var(--space-4));
}
</style>
