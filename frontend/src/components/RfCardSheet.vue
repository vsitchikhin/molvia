<template>
  <BottomSheet :open="open" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('pay.rf.title') }}</template>
    <p class="body">{{ t('pay.rf.body') }}</p>
    <template #footer>
      <AppButton size="large" block @click="$emit('update:open', false)">
        {{ t('pay.rf.ok') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/AppButton.vue'
import BottomSheet from '@/components/BottomSheet.vue'

/**
 * «Карты российских банков» (MOL-277, Р-8): the bank takes no card a Russian bank issued (MOL-282), and the sheet
 * says so. It only speaks: the tap that opens it is counted by the button (`useRfCardTap`, review №5).
 */
export default defineComponent({
  name: 'RfCardSheet',
  components: { AppButton, BottomSheet },
  props: { open: { type: Boolean, required: true } },
  emits: { 'update:open': (open: boolean) => typeof open === 'boolean' },
  setup() {
    const { t } = useI18n()
    return { t }
  },
})
</script>

<style scoped lang="scss">
.body {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
