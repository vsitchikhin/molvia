import { computed, ref, watch } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import type { ActorSettings } from '@molvia/model'
import { useActorStore } from '@/stores/actor'
import { useTripQueueStore } from '@/stores/tripQueue'

export function useTripContext(
  open: Ref<boolean>,
  close: () => void,
): {
  draft: Ref<ActorSettings | null>
  /** Counts the openings: the fields are keyed by it, so each one gets a form of its own. */
  opening: Ref<number>
  valid: ComputedRef<boolean>
  confirm(): void
} {
  const actor = useActorStore()
  const queue = useTripQueueStore()
  const draft = ref<ActorSettings | null>(null)
  const tripId = ref<string | null>(null)
  const owner = ref<string | null>(null)
  const opening = ref(0)
  watch(open, (value) => {
    if (!value) return
    owner.value = actor.id
    tripId.value = queue.needsContext
    draft.value = actor.settings ? { ...actor.settings } : null
    opening.value += 1
  })
  const valid = computed(
    () => actor.id === owner.value && queue.needsContext === tripId.value && draft.value !== null,
  )
  function confirm(): void {
    if (!valid.value || !draft.value || !tripId.value) return
    queue.supplyContext(tripId.value, draft.value)
    close()
  }
  return { draft, opening, valid, confirm }
}
