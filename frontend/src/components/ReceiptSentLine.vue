<template>
  <p v-if="shown" class="sent">
    <IconCheck class="icon" aria-hidden="true" />
    {{ t('receipt.capture.sent') }}
  </p>
</template>

<script lang="ts">
import { defineComponent, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/mdi/check-circle-outline'
import { useReceiptQueueStore } from '@/stores/receiptQueue'

/** How long «Чек отправлен» stands in place of «Вернуть» (handoff 03, 3d). */
const SENT_SHOWN_MS = 2200

/**
 * «Чек отправлен» (handoff v2, 3d): a quiet line where the strip's «Вернуть» stands, for a moment,
 * after «Отправить чек». No toast; the words are said by the button that sent it.
 */
export default defineComponent({
  name: 'ReceiptSentLine',
  components: { IconCheck },
  setup() {
    const { t } = useI18n()
    const queue = useReceiptQueueStore()
    const shown = ref(false)
    let timer: ReturnType<typeof setTimeout> | undefined
    watch(
      () => queue.sentAt,
      (at) => {
        clearTimeout(timer)
        const left = at === null ? 0 : at + SENT_SHOWN_MS - Date.now()
        shown.value = left > 0
        if (left > 0)
          timer = setTimeout(() => {
            shown.value = false
          }, left)
      },
      { immediate: true },
    )
    onBeforeUnmount(() => {
      clearTimeout(timer)
    })
    return { t, shown }
  },
})
</script>

<style scoped lang="scss">
.sent {
  @include appear;

  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin: 0;
  font-size: var(--text-callout);
}

.icon {
  flex: none;
  width: 1.25rem;
  height: 1.25rem;
  color: var(--good-ink);
}
</style>
