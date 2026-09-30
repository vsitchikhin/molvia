import { onUnmounted, ref, shallowRef } from 'vue'
import type { Ref } from 'vue'
import { inStoreBarcode } from '@molvia/model'
import type { CatalogueEntry } from '@molvia/model'
import { api } from '@/api'
import { useReconnect } from '@/composables/useReconnect'

// Asked afresh each time, as the search asks it: the answer before the request says nothing about
// the connection by the time the request has failed.
function connected(): boolean {
  return navigator.onLine
}

/**
 * `idle` — no code looked up, or its answer handed on. `loading` — the code is on its way.
 * `missing` — the catalogue holds no item with it. `offline` — no connection, and the device knows
 * no item by it either. `error` — the server did not answer; «Повторить» asks again. `found` — an
 * item found by a retry nobody tapped for, waiting for a tap (`take`) rather than opening a sheet by
 * itself (adversarial Ж′). `label` — a shop's own code, a scale's label (MOL-100, В-4): the catalogue
 * never holds one, so nobody is asked.
 */
export type BarcodeLookupPhase =
  'idle' | 'loading' | 'missing' | 'offline' | 'error' | 'found' | 'label'

export interface BarcodeLookup {
  readonly phase: Ref<BarcodeLookupPhase>
  /** The code the phase is about — «Код … справочнику не знаком» names it. */
  readonly code: Ref<string | null>
  /** What `found` found. */
  readonly item: Ref<CatalogueEntry | null>
  /** Hands on the item `found` holds, as a lookup the person asked for would have. */
  readonly take: () => void
  readonly lookUp: (code: string) => void
  readonly retry: () => void
  /** Back to `idle`, an answer still on its way dropped: the person types instead. */
  readonly clear: () => void
}

export interface BarcodeLookupOptions {
  /** The item found, with the code it was found by. */
  readonly found: (entry: CatalogueEntry, code: string) => void
  /** The device's own memory of codes (MOL-99, В-2): what is looked up while the network is gone. */
  readonly local: (code: string) => CatalogueEntry | null
}

/**
 * The item a scanned or typed code belongs to, on «Что взяли?» (MOL-99).
 *
 * One lookup at a time: a new code, or typing, drops the one still out, and an answer that lands
 * anyway is dropped by its number. Offline is told from error by the connection after the
 * failure, as the search tells them (MOL-19), and both fall back to the codes this device found
 * items by — an error only once that finds nothing, since a server that does not answer still
 * leaves the package in the hand at the shelf.
 */
export function useBarcodeLookup(options: BarcodeLookupOptions): BarcodeLookup {
  const phase = ref<BarcodeLookupPhase>('idle')
  const code = ref<string | null>(null)
  const item = shallowRef<CatalogueEntry | null>(null)

  let latest = 0
  let inFlight: AbortController | undefined

  function drop(): void {
    latest += 1
    inFlight?.abort()
    inFlight = undefined
  }

  // A retry nobody tapped for does not open a sheet: it may come on a phone just unlocked, over a
  // sheet the person opened meanwhile, and a sheet laid without a tap is one Chrome skips on «back».
  function hand(entry: CatalogueEntry, read: string, quiet: boolean): void {
    if (quiet) {
      item.value = entry
      phase.value = 'found'
      return
    }
    phase.value = 'idle'
    code.value = null
    item.value = null
    options.found(entry, read)
  }

  function fromDevice(read: string, quiet: boolean): boolean {
    const entry = options.local(read)
    if (entry) hand(entry, read, quiet)
    return entry !== null
  }

  /** `quiet` keeps what is on screen until the answer replaces it — a retry nobody asked for. */
  async function run(read: string, quiet = false): Promise<void> {
    drop()
    const mine = latest
    code.value = read
    item.value = null

    if (inStoreBarcode(read)) {
      phase.value = 'label'
      return
    }

    if (!connected()) {
      if (!fromDevice(read, quiet)) phase.value = 'offline'
      return
    }

    if (!quiet) phase.value = 'loading'
    const controller = new AbortController()
    inFlight = controller
    try {
      const entry = await api.catalogueByBarcode(read, { signal: controller.signal })
      if (mine !== latest) return
      if (entry) hand(entry, read, quiet)
      else phase.value = 'missing'
    } catch {
      if (mine !== latest) return
      if (!fromDevice(read, quiet)) phase.value = connected() ? 'error' : 'offline'
    } finally {
      if (inFlight === controller) inFlight = undefined
    }
  }

  function lookUp(read: string): void {
    void run(read)
  }

  function retry(): void {
    if (code.value !== null) void run(code.value)
  }

  function take(): void {
    const found = item.value
    const read = code.value
    if (phase.value !== 'found' || found === null || read === null) return
    hand(found, read, false)
  }

  function clear(): void {
    drop()
    phase.value = 'idle'
    code.value = null
    item.value = null
  }

  // The connection may be back, or the app is looked at again — which the search hears too: «Нет
  // сети» must not outlive the network (adversarial Ж). Quietly, as the search does: the block stays
  // until the answer replaces it.
  useReconnect(() => {
    if ((phase.value === 'offline' || phase.value === 'error') && code.value !== null) {
      void run(code.value, true)
    }
  })

  onUnmounted(drop)

  return { phase, code, item, take, lookUp, retry, clear }
}
