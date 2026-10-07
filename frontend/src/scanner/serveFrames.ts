import { prepareZXingModule } from 'zxing-wasm/reader'
import { locateWasm } from './decode'
import type { ReaderReply, ReaderRequest } from './protocol'

/**
 * The inside of a decoding worker: zxing loaded from the app's own origin, each request answered by
 * `decode` or by what failed. One loop for the scanner's worker and the receipt's QR worker (MOL-233),
 * each with its own options.
 */
export function serveFrames<T>(decode: (frame: ImageData) => Promise<T | null>): void {
  prepareZXingModule({ overrides: { locateFile: locateWasm } })

  const scope = self as unknown as {
    onmessage: ((event: MessageEvent<ReaderRequest>) => void) | null
    postMessage(reply: ReaderReply<T>): void
  }

  scope.onmessage = ({ data: request }) => {
    const work =
      request.kind === 'warm'
        ? prepareZXingModule({ overrides: { locateFile: locateWasm }, fireImmediately: true }).then(
            () => null,
          )
        : decode(new ImageData(request.pixels, request.width, request.height))
    work.then(
      (code) => {
        scope.postMessage({ id: request.id, ok: true, code })
      },
      (error: unknown) => {
        // The worker carries no model: the page describes the failure (MOL-144, Р-11).
        scope.postMessage({
          id: request.id,
          ok: false,
          ...(error instanceof Error
            ? { failure: { name: error.name, message: error.message, stack: error.stack ?? '' } }
            : {}),
        })
      },
    )
  }
}
