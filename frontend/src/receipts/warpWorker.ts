import { warp } from '@/receipts/warp'
import type { Quad, Size } from '@/receipts/warp'

/** One receipt to straighten: the pixels of the box around its corners, moved here, not copied. */
export interface WarpRequest {
  readonly id: number
  readonly pixels: Uint8ClampedArray
  readonly width: number
  readonly height: number
  /** The corners in the box's own coordinates. */
  readonly quad: Quad
  readonly size: Size
}

export type WarpReply =
  | {
      readonly id: number
      readonly ok: true
      readonly pixels: Uint8ClampedArray
      readonly width: number
      readonly height: number
    }
  | { readonly id: number; readonly ok: false }

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WarpRequest>) => void) | null
  postMessage(reply: WarpReply, transfer?: Transferable[]): void
}

// MOL-222: the warp of a receipt is a few million pixels drawn from sixteen each — off the page, so
// «Готово» shows it is working rather than the screen freezing on an old phone.
scope.onmessage = ({ data: request }) => {
  try {
    const out = warp(
      { data: request.pixels, width: request.width, height: request.height },
      request.quad,
      request.size,
    )
    scope.postMessage(
      { id: request.id, ok: true, pixels: out.data, width: out.width, height: out.height },
      [out.data.buffer],
    )
  } catch {
    scope.postMessage({ id: request.id, ok: false })
  }
}
