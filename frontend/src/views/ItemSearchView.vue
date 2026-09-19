<template>
  <AppScreen :title="t('item.search_title')" />
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import AppScreen from '@/components/AppScreen.vue'

/**
 * A place for the screen, not the screen: the router and the tab bar need somewhere to lead.
 * Replaced whole by the catalogue search — MOL-23.
 */
export default defineComponent({
  name: 'ItemSearchView',
  components: { AppScreen },
  setup() {
    const { t } = useI18n()
    return { t }
  },
})
</script>
