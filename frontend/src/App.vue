<template>
  <header class="header">
    <h1 class="title">{{ t('app.name') }}</h1>
  </header>
  <main class="main">
    <RouterView />
  </main>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'

export default defineComponent({
  name: 'AppRoot',
  setup() {
    const { t } = useI18n()
    return { t }
  },
})
</script>

<style scoped lang="scss">
.header {
  padding: var(--space-4);
  border-bottom: var(--hairline) solid var(--border);
}

.title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-title);
  font-weight: var(--weight-bold);
}

.main {
  padding: var(--space-4);
}
</style>
