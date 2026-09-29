import { prepareZXingModule } from 'zxing-wasm/reader'
import { decodeFrame, locateWasm } from './decode'
import type { ReaderReply, ReaderRequest } from './protocol'

prepareZXingModule({ overrides: { locateFile: locateWasm } })

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ReaderRequest>) => void) | null
  postMessage(reply: ReaderReply): void
}

scope.onmessage = ({ data: request }) => {
  const work =
    request.kind === 'warm'
      ? prepareZXingModule({ overrides: { locateFile: locateWasm }, fireImmediately: true }).then(
          () => null,
        )
      : decodeFrame(new ImageData(request.pixels, request.width, request.height))
  work.then(
    (code) => {
      scope.postMessage({ id: request.id, ok: true, code })
    },
    () => {
      scope.postMessage({ id: request.id, ok: false })
    },
  )
}
