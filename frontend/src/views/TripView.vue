<template>
  <h1 class="title">{{ t('trip.title') }}</h1>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * A place for the screen, not the screen: the router and the tab bar need somewhere to lead.
 * Replaced whole by «Поход» — MOL-22.
 */
export default defineComponent({
  name: 'TripView',
  setup() {
    const { t } = useI18n()
    return { t }
  },
})
</script>

<style scoped lang="scss">
.title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-display);
  line-height: var(--leading-tight);
}
</style>
