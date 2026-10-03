<template>
  <UndoStrip
    v-if="removed"
    :key="removed.stamp"
    :seconds="removed.left"
    :quiet="removed.quiet"
    :text="t('purchases.deleted')"
    :announcement="t('purchases.deleted')"
    :action="t('trip.remove.restore')"
    @restore="restore"
    @expire="queue.forgetRemoved()"
  />
</template>

<script lang="ts">
import { computed, defineComponent, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import UndoStrip from '@/components/UndoStrip.vue'
import { useReceiptQueueStore } from '@/stores/receiptQueue'

/** The ten seconds of the strip: counted from the removal, not from each screen showing it. */
const SECONDS = 10
/** Removals whose strip has been shown once: said aloud and given the focus then, and only then. */
const shown = new Set<number>()

/**
 * «Чек удалён вместе с фото · Вернуть» (П-8, handoff 03): ten seconds on the screen, ten minutes on
 * the server, as a trip's and a spending's. The removal is the queue's, so the strip stands on
 * «Покупки» whichever screen the receipt was removed from.
 */
export default defineComponent({
  name: 'ReceiptUndoStrip',
  components: { UndoStrip },
  setup() {
    const { t } = useI18n()
    const queue = useReceiptQueueStore()
    const removed = computed(() => {
      const value = queue.lastRemoved
      if (!value) return null
      const left = SECONDS - Math.floor((Date.now() - value.stamp) / 1000)
      return left > 0 ? { ...value, left, quiet: shown.has(value.stamp) } : null
    })
    watch(
      () => queue.lastRemoved,
      (value) => {
        if (!value) return
        if (removed.value) shown.add(value.stamp)
        else queue.forgetRemoved()
      },
      { immediate: true, flush: 'post' },
    )

    function restore(): void {
      const value = queue.lastRemoved
      if (value) queue.restore(value.undo)
    }

    return { t, queue, removed, restore }
  },
})
</script>
