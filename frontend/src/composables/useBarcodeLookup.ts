import { onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'
import type { CatalogueEntry } from '@molvia/model'
import { api } from '@/api'

// Asked afresh each time, as the search asks it: the answer before the request says nothing about
// the connection by the time the request has failed.
function connected(): boolean {
  return navigator.onLine
}

/**
 * `idle` — no code looked up, or its answer handed on. `loading` — the code is on its way.
 * `missing` — the catalogue holds no item with it. `offline` — no connection, and the device knows
 * no item by it either. `error` — the server did not answer; «Повторить» asks again.
 */
export type BarcodeLookupPhase = 'idle' | 'loading' | 'missing' | 'offline' | 'error'

export interface BarcodeLookup {
  readonly phase: Ref<BarcodeLookupPhase>
  /** The code the phase is about — «Код … справочнику не знаком» names it. */
  readonly code: Ref<string | null>
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

  let latest = 0
  let inFlight: AbortController | undefined

  function drop(): void {
    latest += 1
    inFlight?.abort()
    inFlight = undefined
  }

  function hand(entry: CatalogueEntry, read: string): void {
    phase.value = 'idle'
    code.value = null
    options.found(entry, read)
  }

  function fromDevice(read: string): boolean {
    const entry = options.local(read)
    if (entry) hand(entry, read)
    return entry !== null
  }

  async function run(read: string): Promise<void> {
    drop()
    const mine = latest
    code.value = read

    if (!connected()) {
      if (!fromDevice(read)) phase.value = 'offline'
      return
    }

    phase.value = 'loading'
    const controller = new AbortController()
    inFlight = controller
    try {
      const entry = await api.catalogueByBarcode(read, { signal: controller.signal })
      if (mine !== latest) return
      if (entry) hand(entry, read)
      else phase.value = 'missing'
    } catch {
      if (mine !== latest) return
      if (!fromDevice(read)) phase.value = connected() ? 'error' : 'offline'
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

  function clear(): void {
    drop()
    phase.value = 'idle'
    code.value = null
  }

  onUnmounted(drop)

  return { phase, code, lookUp, retry, clear }
}
