import type { ReaderFailure, ReaderReply, ReaderRequest } from './protocol'

/** The part of a worker the reader uses — so a test can hand it a fake. */
export interface ReaderWorker<T = string> {
  postMessage(request: ReaderRequest, transfer: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent<ReaderReply<T>>) => void): void
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  terminate(): void
}

export interface FrameReader<T> {
  /** Loads the reader ahead, while the camera starts. */
  warm: () => Promise<void>
  /** Reads one frame; its pixels move to the worker and are gone from the caller. */
  read: (frame: ImageData) => Promise<T | null>
  dispose: () => void
}

export type BarcodeReader = FrameReader<string>

/** The reader failed; `cause` is what failed in the worker, when it said (MOL-144, Р-11). */
export class ReaderFailed extends Error {
  constructor(cause?: Error) {
    super('barcode reader failed', cause === undefined ? undefined : { cause })
    this.name = 'ReaderFailed'
  }
}

/** The worker's failure brought back as an error of the page, to be described like any other. */
function failureOf({ name, message, stack }: ReaderFailure): Error {
  const error = new Error(message)
  error.name = name
  error.stack = stack
  return error
}

/**
 * A throw the worker did not catch: the browser names the file, the line and the column, and the
 * message, which is left out — one frame at the place, `WorkerError` for its kind.
 */
function uncaughtOf(event: ErrorEvent | undefined): Error | undefined {
  if (event?.filename === undefined || event.filename === '') return undefined
  const error = new Error()
  error.name = 'WorkerError'
  error.stack = `${event.filename}:${String(event.lineno)}:${String(event.colno)}`
  return error
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
  return createFrameReader(worker)
}

/**
 * A decoding worker of any answer seen from the page — the scanner's, and the QR codes of a
 * receipt's photo (MOL-233), each with a worker and options of its own.
 */
export function createFrameReader<T>(worker: ReaderWorker<T>): FrameReader<T> {
  const waiting = new Map<
    number,
    { resolve: (code: T | null) => void; reject: (cause?: Error) => void }
  >()
  let next = 0
  let failed = false
  let failure: Error | undefined

  const fail = (cause?: Error) => {
    failed = true
    failure ??= cause
    for (const request of waiting.values()) request.reject(cause)
    waiting.clear()
  }
  worker.addEventListener('error', (event) => {
    fail(uncaughtOf(event))
  })
  worker.addEventListener('message', ({ data: reply }) => {
    const request = waiting.get(reply.id)
    if (!request) return
    waiting.delete(reply.id)
    if (reply.ok) request.resolve(reply.code)
    else request.reject(reply.failure === undefined ? undefined : failureOf(reply.failure))
  })

  const ask = (request: ReaderRequest, transfer: Transferable[]) =>
    new Promise<T | null>((resolve, reject) => {
      if (failed) {
        reject(new ReaderFailed(failure))
        return
      }
      waiting.set(request.id, {
        resolve,
        reject: (cause) => {
          reject(new ReaderFailed(cause))
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
