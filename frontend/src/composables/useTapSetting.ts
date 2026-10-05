import { onMounted, onUnmounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { useReconnect } from '@/composables/useReconnect'
import { useActorStore } from '@/stores/actor'
import { reportFailure } from '@/failures'

export interface TapSettingState<T> {
  /** The server's answer; undefined while it is not known yet. */
  readonly value: Ref<T | undefined>
  /** Why the setting could not be read — decided after the failure (MOL-19, A1). */
  readonly failure: Ref<'offline' | 'error' | null>
  readonly online: Ref<boolean>
  readonly saving: Ref<boolean>
  /** The last change did not reach an answer: the control is back where the server holds it. */
  readonly saveFailed: Ref<boolean>
  retry(): Promise<void>
  choose(next: T): Promise<void>
}

/**
 * A setting of the person's own saved on the tap, beside the settings form and never under its
 * «Сохранить» (MOL-134, В-5; MOL-103, Р-1). Nothing is kept on the phone: without a connection the
 * control waits, and what it shows is always what the server answered. `read` and `write` are the
 * two calls of its own address.
 */
export function useTapSetting<T>(
  read: () => Promise<T>,
  write: (next: T) => Promise<T>,
): TapSettingState<T> {
  const actor = useActorStore()
  const value = ref<T | undefined>(undefined) as Ref<T | undefined>
  const failure = ref<'offline' | 'error' | null>(null)
  const online = ref(navigator.onLine)
  const saving = ref(false)
  const saveFailed = ref(false)
  // A read that left before a change is older than it: its answer must not put the control back.
  let latest = 0
  // A change whose answer never came may have landed all the same — the answer, not the request,
  // is what a dropped connection loses — so what the control shows is only a guess until the
  // server is read again (adversarial MOL-96 А2): a privacy switch put back to «on» over a server
  // that already turned it off.
  let unsure: { readonly shown: T } | null = null

  async function load(): Promise<void> {
    if (!actor.id || saving.value) return
    const mine = ++latest
    try {
      const answer = await read()
      if (mine !== latest) return
      // The change did land after all: «не сохранилось» is no longer true.
      if (unsure && JSON.stringify(answer) !== JSON.stringify(unsure.shown))
        saveFailed.value = false
      unsure = null
      value.value = answer
      failure.value = null
    } catch (error) {
      reportFailure(error, 'screen')
      if (mine !== latest) return
      failure.value = navigator.onLine ? 'error' : 'offline'
    }
  }

  // Shown at once and taken back if the answer does not come: the switch the browser already moved
  // has to follow the server, or a screen reader reads out a choice nobody holds.
  async function choose(next: T): Promise<void> {
    if (saving.value || value.value === undefined || value.value === next) return
    const shown = value.value
    latest += 1
    value.value = next
    saving.value = true
    saveFailed.value = false
    try {
      value.value = await write(next)
      unsure = null
    } catch {
      value.value = shown
      unsure = { shown }
      // Offline or failed is decided after the failure (MOL-19, A1): a connection that dropped while
      // the answer was on its way is the grey «без связи», never the red «не сохранилось» (self-review 7).
      online.value = navigator.onLine
      saveFailed.value = online.value
    } finally {
      saving.value = false
    }
    // Asked at once while there is a connection; without one, when it comes back (below).
    if (unsure && online.value) await load()
  }

  const offline = (): void => {
    online.value = false
  }
  onMounted(() => {
    window.addEventListener('offline', offline)
    void load()
  })
  onUnmounted(() => {
    window.removeEventListener('offline', offline)
  })
  // The owner is named after the screen may already be up: a cold start asks `me()` first.
  watch(
    () => actor.id,
    (id) => {
      if (id && value.value === undefined) void load()
    },
  )
  useReconnect(() => {
    online.value = navigator.onLine
    if (online.value && (value.value === undefined || failure.value || unsure)) void load()
  })

  return { value, failure, online, saving, saveFailed, retry: load, choose }
}
