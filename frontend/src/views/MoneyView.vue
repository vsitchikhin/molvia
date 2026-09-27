<template>
  <AppScreen :title="t('spending.title')">
    <template #subtitle>{{ t('spending.subtitle') }}</template>
  </AppScreen>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import AppScreen from '@/components/AppScreen.vue'

/** «Деньги» (MOL-82): the month of one's own spending, counted by the server. */
export default defineComponent({
  name: 'MoneyView',
  components: { AppScreen },
  setup() {
    const { t } = useI18n()
    return { t }
  },
})
</script>

<style scoped lang="scss">
/* The screen is drawn by its blocks; its own layout comes with them. */
</style>
