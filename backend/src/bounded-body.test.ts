import { describe, expect, it } from 'vitest'
import { boundedBody, boundedText } from './bounded-body'

class TooLarge extends Error {}

const tooLarge = () => new TooLarge('too large')

/** A body handed out a chunk a pull, counting the pulls and whether it was cancelled. */
function counted(chunks: number, size: number, headers: Record<string, string> = {}) {
  const seen = { pulls: 0, cancelled: false }
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        seen.pulls += 1
        if (seen.pulls > chunks) controller.close()
        else controller.enqueue(new Uint8Array(size).fill(0x61))
      },
      cancel() {
        seen.cancelled = true
      },
    },
    // Nothing is pulled before somebody reads: the count is the reader's alone.
    { highWaterMark: 0 },
  )
  return { response: new Response(body, { headers }), seen }
}

describe('the body of another server’s answer, under a ceiling (MOL-368)', () => {
  it('a length the headers name past the ceiling is refused before a byte is taken', async () => {
    const { response, seen } = counted(4, 1024, { 'content-length': String(4 * 1024) })

    await expect(boundedBody(response, 4 * 1024 - 1, tooLarge)).rejects.toBeInstanceOf(TooLarge)
    expect(seen.pulls).toBe(0)
    expect(seen.cancelled).toBe(true)
  })

  it('a body with no length is cut off at the ceiling, never read to its end', async () => {
    const { response, seen } = counted(1_000_000, 1024)

    await expect(boundedBody(response, 4 * 1024, tooLarge)).rejects.toBeInstanceOf(TooLarge)
    expect(seen.pulls).toBe(5)
    expect(seen.cancelled).toBe(true)
  })

  it('a length that lies is cut off all the same', async () => {
    const { response, seen } = counted(1_000_000, 1024, { 'content-length': '10' })

    await expect(boundedBody(response, 4 * 1024, tooLarge)).rejects.toBeInstanceOf(TooLarge)
    expect(seen.pulls).toBe(5)
  })

  it('a body of exactly the ceiling is read whole', async () => {
    const { response } = counted(4, 1024, { 'content-length': String(4 * 1024) })

    const bytes = await boundedBody(response, 4 * 1024, tooLarge)

    expect(bytes.byteLength).toBe(4 * 1024)
  })

  it('no body is no bytes', async () => {
    expect((await boundedBody(new Response(null), 10, tooLarge)).byteLength).toBe(0)
  })

  it('as text it reads as `response.text()` does: UTF-8, a byte order mark dropped', async () => {
    const sent = '﻿Ереван · Բաժին · 5 403,12 ֏'

    expect(await boundedText(new Response(sent), 1024, tooLarge)).toBe(
      await new Response(sent).text(),
    )
  })
})
