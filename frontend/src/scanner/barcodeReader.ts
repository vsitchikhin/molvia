import type { ReaderReply, ReaderRequest } from './protocol'

/** The part of a worker the reader uses — so a test can hand it a fake. */
export interface ReaderWorker {
  postMessage(request: ReaderRequest, transfer: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent<ReaderReply>) => void): void
  addEventListener(type: 'error', listener: () => void): void
  terminate(): void
}

export interface BarcodeReader {
  /** Loads the reader ahead, while the camera starts. */
  warm: () => Promise<void>
  /** Reads one frame; its pixels move to the worker and are gone from the caller. */
  read: (frame: ImageData) => Promise<string | null>
  dispose: () => void
}

export class ReaderFailed extends Error {
  constructor() {
    super('barcode reader failed')
    this.name = 'ReaderFailed'
  }
}

function spawn(): ReaderWorker {
  return new Worker(new URL('./barcodeWorker.ts', import.meta.url), { type: 'module' })
}

/**
 * The decoding worker seen from the page (MOL-98). Decoding off the main thread keeps the
 * viewfinder smooth; one frame at a time is the caller's loop awaiting `read`, so a slow phone
 * reads the latest frame rather than a queue of old ones. A worker that fails fails every
 * request still waiting and every one after it — the sheet shows its error state.
 */
export function createBarcodeReader(worker: ReaderWorker = spawn()): BarcodeReader {
  const waiting = new Map<number, { resolve: (code: string | null) => void; reject: () => void }>()
  let next = 0
  let failed = false

  const fail = () => {
    failed = true
    for (const request of waiting.values()) request.reject()
    waiting.clear()
  }
  worker.addEventListener('error', fail)
  worker.addEventListener('message', ({ data: reply }) => {
    const request = waiting.get(reply.id)
    if (!request) return
    waiting.delete(reply.id)
    if (reply.ok) request.resolve(reply.code)
    else request.reject()
  })

  const ask = (request: ReaderRequest, transfer: Transferable[]) =>
    new Promise<string | null>((resolve, reject) => {
      if (failed) {
        reject(new ReaderFailed())
        return
      }
      waiting.set(request.id, {
        resolve,
        reject: () => {
          reject(new ReaderFailed())
        },
      })
      worker.postMessage(request, transfer)
    })

  return {
    warm: () => ask({ id: next++, kind: 'warm' }, []).then(() => undefined),
    read: (frame) =>
      ask(
        { id: next++, kind: 'read', pixels: frame.data, width: frame.width, height: frame.height },
        [frame.data.buffer],
      ),
    dispose: () => {
      fail()
      worker.terminate()
    },
  }
}
