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

  let sharing = false

  // Called straight from a tap on the second try: `navigator.share` goes out before any await.
  async function deliver(file: File, retryable: boolean): Promise<void> {
    if (onTouch() && 'canShare' in navigator && navigator.canShare({ files: [file] })) {
      sharing = true
      try {
        await navigator.share({ files: [file] })
        ready.value = null
        return
      } catch (error) {
        // Closed by the person, the sheet of a Mac without «Save» among its places included: the
        // file stays under «Файл готов» rather than vanish with nothing saved.
        if (named(error, 'AbortError') || (named(error, 'NotAllowedError') && retryable)) {
          ready.value = file
          return
        }
        // A sheet still open from the tap before: it is that sheet's file, not a download too.
        if (named(error, 'InvalidStateError')) return
      } finally {
        sharing = false
      }
    }
    ready.value = null
    download(file)
  }

  async function start(): Promise<void> {
    if (busy.value || sharing || !online.value) return
    busy.value = true
    failure.value = null
    ready.value = null
    let file: File
    try {
      const text = await api.exportMine()
      file = new File([text], `molvia-${yerevanDate(new Date())}.json`, {
        type: 'application/json',
      })
    } catch {
      online.value = navigator.onLine
      failure.value = online.value ? 'error' : 'offline'
      return
    } finally {
      busy.value = false
    }
    await deliver(file, true)
  }

  function handOver(): void {
    if (ready.value && !sharing) void deliver(ready.value, false)
  }

  const offline = (): void => {
    online.value = false
  }
  onMounted(() => {
    window.addEventListener('offline', offline)
  })
  onUnmounted(() => {
    window.removeEventListener('offline', offline)
  })
  useReconnect(() => {
    online.value = navigator.onLine
    if (online.value && failure.value === 'offline') failure.value = null
  })

  return { online, busy, failure, ready, start, handOver }
}
