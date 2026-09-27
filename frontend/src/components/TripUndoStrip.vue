<template>
  <UndoStrip
    v-if="removed"
    :key="removed.stamp"
    :text="t('trip.remove.removed', { name: removed.name })"
    :announcement="t('trip.remove.removed_announced', { name: removed.name })"
    :action="t('trip.remove.restore')"
    @restore="restore"
    @expire="queue.forgetRemoved()"
  />
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import UndoStrip from '@/components/UndoStrip.vue'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useTripQueueStore } from '@/stores/tripQueue'

/**
 * «Поход удалён · Вернуть» (MOL-76): ten seconds on the screen, ten minutes on the server, as a
 * spending's (MOL-82). Drawn by every screen a removed trip can land on — the home screen, the
 * history, «Деньги» — from the one removal the queue remembers.
 */
export default defineComponent({
  name: 'TripUndoStrip',
  components: { UndoStrip },
  emits: ['restored'],
  setup(_, { emit }) {
    const { t } = useI18n()
    const queue = useTripQueueStore()
    const announce = useAnnouncer()
    const removed = computed(() => queue.lastRemoved)

    function restore(): void {
      const value = queue.lastRemoved
      if (!value) return
      queue.restoreTrip(value)
      announce?.(t('trip.remove.restored'))
      emit('restored')
    }

    return { t, queue, removed, restore }
  },
})
</script>
