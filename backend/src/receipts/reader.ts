import { z } from 'zod'

/**
 * One page mode of one part, on three cores. The bench read a whole receipt — two modes, a part —
 * in 25–30 s (MOL-114); a part three times longer than that is not a receipt the reader will finish.
 */
export const READ_TIMEOUT_MS = 120_000

/** Cutting lines out is Pillow's, a fraction of a second; a minute means the reader is stuck. */
const STRIPS_TIMEOUT_MS = 60_000

const boxSchema = z.tuple([z.int().min(0), z.int().min(0), z.int().min(0), z.int().min(0)])
export type Box = z.infer<typeof boxSchema>

/** What the reader answers for one part read in one page mode: its rows, each with its box or none. */
const readingSchema = z.object({
  text: z.string(),
  rows: z.array(z.object({ text: z.string(), box: boxSchema.nullable() })),
  version: z.string().min(1).max(200),
})
export type ReaderReading = z.infer<typeof readingSchema>

const stripsSchema = z.object({ strips: z.array(z.base64()) })

/**
 * The reader could not be reached, or failed for a reason of its own (MOL-125): the receipt is not
 * at fault and waits in the queue for it to come back.
 */
export class ReaderUnavailable extends Error {
  constructor(readonly reason: string) {
    super(`receipt reader unavailable: ${reason}`)
  }
}

/**
 * The reader took the photo and could not read it — not a picture it can open, out of its time, or
 * an answer that is no reading. The receipt failed, `unreadable`; asking again would fail again.
 */
export class PhotoUnreadable extends Error {
  constructor(readonly reason: string) {
    super(`receipt photo unreadable: ${reason}`)
  }
}

export interface ReceiptReader {
  read(photo: Buffer, languages: string, pageMode: number): Promise<ReaderReading>
  /** The rows under `boxes` cut out of the photo, as PNG, in the order asked. */
  strips(photo: Buffer, boxes: readonly Box[]): Promise<Buffer[]>
}

/**
 * The client of the receipt reader (MOL-125): the container of Tesseract on the compose network,
 * `services/receipt-reader`. It holds nothing; a photo goes in and its text comes out.
 */
export function receiptReader(url: string): ReceiptReader {
  async function ask(path: string, photo: Buffer, timeoutMs: number): Promise<unknown> {
    let answer: Response
    try {
      answer = await fetch(new URL(path, url), {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg' },
        body: photo,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      // our own timeout on a photo the reader is still chewing on is the photo's: the reader
      // gives up on its own a little before, and says so with a 504
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new PhotoUnreadable('timeout')
      }
      throw new ReaderUnavailable('unreachable')
    }
    // 422: the photo did not open; 504: Tesseract ran out of its time on it
    if (answer.status === 422 || answer.status === 504) {
      throw new PhotoUnreadable(answer.status === 504 ? 'timeout' : 'unreadable')
    }
    if (!answer.ok) throw new ReaderUnavailable(`status ${String(answer.status)}`)
    try {
      return await answer.json()
    } catch {
      throw new ReaderUnavailable('not json')
    }
  }

  return {
    async read(photo, languages, pageMode) {
      const query = new URLSearchParams({ langs: languages, psm: String(pageMode) })
      const parsed = readingSchema.safeParse(
        await ask(`/read?${query.toString()}`, photo, READ_TIMEOUT_MS),
      )
      if (!parsed.success) throw new PhotoUnreadable('not a reading')
      return parsed.data
    },
    async strips(photo, boxes) {
      const query = new URLSearchParams({ boxes: boxes.map((box) => box.join(',')).join(';') })
      const parsed = stripsSchema.safeParse(
        await ask(`/strips?${query.toString()}`, photo, STRIPS_TIMEOUT_MS),
      )
      if (!parsed.success || parsed.data.strips.length !== boxes.length) {
        throw new PhotoUnreadable('not strips')
      }
      return parsed.data.strips.map((strip) => Buffer.from(strip, 'base64'))
    },
  }
}
