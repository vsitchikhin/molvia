<template>
  <UndoStrip
    v-if="removed"
    :key="removed.stamp"
    :seconds="removed.left"
    :quiet="removed.quiet"
    :text="t('trip.remove.removed', { name: removed.name })"
    :announcement="t('trip.remove.removed_announced', { name: removed.name })"
    :action="t('trip.remove.restore')"
    @restore="restore"
    @expire="queue.forgetRemoved()"
  />
</template>

<script lang="ts">
import { computed, defineComponent, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import UndoStrip from '@/components/UndoStrip.vue'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useTripQueueStore } from '@/stores/tripQueue'

/** The ten seconds of the strip: counted from the removal, not from each screen showing it. */
const SECONDS = 10
/** Removals whose strip has been shown once: said aloud and given the focus then, and only then. */
const shown = new Set<number>()

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
    /**
     * What is left of the ten seconds (review Р-1): the strip stands on three screens, and each one
     * started it at ten again — a removal an hour old came back with «Вернуть» on the home screen,
     * to meet «прошло больше десяти минут».
     */
    const removed = computed(() => {
      const value = queue.lastRemoved
      if (!value) return null
      const left = SECONDS - Math.floor((Date.now() - value.stamp) / 1000)
      return left > 0 ? { ...value, left, quiet: shown.has(value.stamp) } : null
    })
    // After the strip is drawn: a removal whose time ran out while no screen showed it is
    // forgotten, and one drawn is marked as said.
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
      if (!value) return
      queue.restoreTrip(value)
      announce?.(t('trip.remove.restored'))
      emit('restored')
    }

    return { t, queue, removed, restore }
  },
})
</script>
