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

/**
 * What failed in the worker, as the page needs it to report the failure (MOL-144, Р-11): the error's
 * name, message and stack, so the page describes it by the one rule — the message stays on the
 * phone, cut there like any other's.
 */
export interface ReaderFailure {
  readonly name: string
  readonly message: string
  readonly stack: string
}

/** The worker's answer to one request. */
export type ReaderReply =
  { id: number; ok: true; code: string | null } | { id: number; ok: false; failure?: ReaderFailure }
