/** What the page asks the decoding worker: load the reader ahead, or read one frame. */
export type ReaderRequest =
  | { id: number; kind: 'warm' }
  | {
      id: number
      kind: 'read'
      pixels: Uint8ClampedArray<ArrayBuffer>
      width: number
      height: number
    }

/** The worker's answer to one request; a failure carries no message — the page only needs to know. */
export type ReaderReply = { id: number; ok: true; code: string | null } | { id: number; ok: false }
