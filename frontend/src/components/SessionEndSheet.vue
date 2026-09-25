<template>
  <BottomSheet :open="open" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('devices.end_sheet.title', { device }) }}</template>

    <p class="words">{{ t('devices.end_sheet.body') }}</p>
    <p v-if="failed" class="failed" role="alert">{{ t('devices.end_failed') }}</p>

    <template #footer>
      <AppButton variant="danger-ghost" block :disabled="busy" @click="$emit('confirm')">
        {{ t('devices.end_sheet.confirm') }}
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
 * «Завершить вход на …?» (MOL-57, owner's decision Q2): the device named as the list names it,
 * and what ending does. Nothing to offer back afterwards — the key is deleted, not marked — so the
 * question comes first, the way the bin of an exchange asks (MOL-40, В-5).
 *
 * A failure is said here and the sheet stays: the person is still deciding about that device,
 * and a strip over the list would be one tap further from «try again».
 */
export default defineComponent({
  name: 'SessionEndSheet',
  components: { AppButton, BottomSheet },
  props: {
    open: { type: Boolean, required: true },
    /** The device as the list names it — «Неизвестное устройство» included. */
    device: { type: String, default: '' },
    busy: { type: Boolean, default: false },
    failed: { type: Boolean, default: false },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    confirm: () => true,
  },
  setup() {
    return { t: useI18n().t }
  },
})
</script>

<style scoped lang="scss">
.words,
.failed {
  margin: 0;
  font-size: var(--text-callout);
}

.words {
  color: var(--text-muted);
}

.failed {
  margin-top: var(--space-3);
  padding: var(--space-3);
  border-radius: var(--radius);
  background: var(--bad-tint);
  color: var(--bad-ink);
}
</style>
