<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <header class="header">
    <h1 class="title">{{ t('app.name') }}</h1>
  </header>
  <main class="main">
    <RouterView />
  </main>
</template>

<style scoped>
.header {
  padding: var(--space-4);
  border-bottom: 1px solid var(--border);
}

.title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
}

.main {
  padding: var(--space-4);
}
</style>
