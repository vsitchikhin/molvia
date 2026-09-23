<template>
  <BottomSheet :open="open" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('settings.legacy.title') }}</template>
    <p>{{ t('settings.legacy.body') }}</p>
    <!-- Keyed by the opening: the sheet stays in the tree, and a form that stayed with it
         would offer the city of the previous visit (MOL-65, review 3). -->
    <SettingsFields v-if="draft" :key="opening" v-model="draft" />
    <p v-else>{{ t('settings.context_missing') }}</p>
    <template #footer
      ><AppButton size="large" block :inactive="!valid" @click="confirm">{{
        t('settings.legacy.confirm')
      }}</AppButton></template
    >
  </BottomSheet>
</template>
<script lang="ts">
import { defineComponent, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/AppButton.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import SettingsFields from '@/components/SettingsFields.vue'
import { useTripContext } from '@/composables/useTripContext'
export default defineComponent({
  name: 'TripContextSheet',
  components: { AppButton, BottomSheet, SettingsFields },
  props: { open: { type: Boolean, required: true } },
  emits: ['update:open'],
  setup(props, { emit }) {
    const { t } = useI18n()
    return {
      t,
      ...useTripContext(toRef(props, 'open'), () => {
        emit('update:open', false)
      }),
    }
  },
})
</script>
<style scoped lang="scss">
p {
  margin: 0 0 var(--space-4);
  color: var(--text-muted);
}
</style>
