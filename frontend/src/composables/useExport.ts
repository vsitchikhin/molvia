import { onMounted, onUnmounted, ref, shallowRef } from 'vue'
import type { Ref } from 'vue'
import { yerevanDate } from '@molvia/model'
import { api } from '@/api'
import { useReconnect } from '@/composables/useReconnect'

export interface ExportState {
  readonly online: Ref<boolean>
  readonly busy: Ref<boolean>
  /** Why the file could not be made — decided after the failure (MOL-19, A1). */
  readonly failure: Ref<'offline' | 'error' | null>
  /** A file the phone would not share on the first tap: the second one hands it over. */
  readonly ready: Ref<File | null>
  start(): Promise<void>
  handOver(): void
}

function named(error: unknown, name: string): boolean {
  return error instanceof DOMException && error.name === name
}

/**
 * A phone, and not a computer: the share sheet of a Mac has no «Save» among its places, and a
 * download is what a person with a mouse expects.
 */
function onTouch(): boolean {
  return window.matchMedia('(pointer: coarse)').matches
}

function download(file: File): void {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  document.body.append(link)
  link.click()
  link.remove()
  // Revoked later rather than at once: Safari starts the download after the click returns.
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 60_000)
}

/**
 * «Скачать мои данные» (MOL-93, В-1): the file is asked of the server, then offered on the share
 * sheet — «Сохранить в Файлы», to oneself in Telegram — where a phone can share a file, and
 * downloaded where it cannot or on a computer. Safari opens the sheet only close to a tap, and the request stands
 * between the two: refused, the file waits for a second tap on «Сохранить или отправить».
 */
export function useExport(): ExportState {
  const online = ref(navigator.onLine)
  const busy = ref(false)
  const failure = ref<'offline' | 'error' | null>(null)
  // Shallow: a File behind a reactive proxy is not a File to `navigator.share`.
  const ready = shallowRef<File | null>(null)

  // The last file handed to a sheet: a sheet that settles late speaks only for its own file, never
  // over a newer one under «Файл готов» (adversarial Р3-А).
  let latest: File | null = null

  // Called straight from a tap on the second try: `navigator.share` goes out before any await.
  async function deliver(file: File, retryable: boolean): Promise<void> {
    latest = file
    if (onTouch() && 'canShare' in navigator && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] })
        if (latest === file) ready.value = null
        return
      } catch (error) {
        if (latest !== file) return
        // Closed by the person — the sheet of a Mac without «Save» among its places included — or
        // refused because a sheet is still open (`InvalidStateError`, the browser's own guard): the
        // file stays under «Файл готов», never downloaded over a sheet, never thrown away.
        if (
          named(error, 'AbortError') ||
          named(error, 'InvalidStateError') ||
          (named(error, 'NotAllowedError') && retryable)
        ) {
          ready.value = file
          return
        }
      }
    }
    ready.value = null
    download(file)
  }

  // Leaving the screen is changing one's mind (review 13, adversarial В): the request is cancelled
  // and nothing is handed over on another screen — a sheet there would be refused anyway.
  let leaving: AbortController | null = null

  async function start(): Promise<void> {
    if (busy.value || !online.value) return
    busy.value = true
    failure.value = null
    ready.value = null
    const mine = new AbortController()
    leaving = mine
    let file: File
    try {
      const { text, exportedAt } = await api.exportMine({ signal: mine.signal })
      // Named by the day the server took it, not by the phone's clock after the answer.
      file = new File([text], `molvia-${yerevanDate(exportedAt)}.json`, {
        type: 'application/json',
      })
    } catch {
      if (mine.signal.aborted) return
      online.value = navigator.onLine
      failure.value = online.value ? 'error' : 'offline'
      return
    } finally {
      busy.value = false
    }
    if (mine.signal.aborted) return
    await deliver(file, true)
  }

  // No guard of our own: over an open sheet the browser answers `InvalidStateError` itself, and a
  // counter of ours stuck on a sheet that never settled left this button dead (review 22).
  function handOver(): void {
    if (ready.value) void deliver(ready.value, false)
  }

  const offline = (): void => {
    online.value = false
  }
  onMounted(() => {
    window.addEventListener('offline', offline)
  })
  onUnmounted(() => {
    leaving?.abort()
    window.removeEventListener('offline', offline)
  })
  useReconnect(() => {
    online.value = navigator.onLine
    if (online.value && failure.value === 'offline') failure.value = null
  })

  return { online, busy, failure, ready, start, handOver }
}
