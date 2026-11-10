/**
 * The body of another server's answer, never held past a ceiling (audit MOL-287 Ф-17, MOL-368).
 *
 * The host a request goes to is the code's and a timeout bounds the wait, but `response.text()` holds
 * whatever comes within it: a gigabyte sent in ten seconds was a gigabyte in the API's memory. A length
 * the headers name past the ceiling refuses before a byte is taken; a body with no length, or one that
 * lies about it, is read in chunks and cut off at the ceiling (the market's reader, MOL-137 review В).
 * `tooLarge` is the caller's own failure, so each client says it in its own words.
 */
export async function boundedBody(
  response: Response,
  maxBytes: number,
  tooLarge: () => Error,
): Promise<ArrayBuffer> {
  if (lengthPast(response.headers, maxBytes)) {
    await response.body?.cancel()
    throw tooLarge()
  }
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = response.body?.getReader()
  if (!reader) return new ArrayBuffer(0)
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw tooLarge()
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  return bytes.buffer
}

/** A length the headers name past the ceiling — of an answer, or of a `HEAD` before one. */
export function lengthPast(headers: Headers, maxBytes: number): boolean {
  const length = Number(headers.get('content-length'))
  return Number.isFinite(length) && length > maxBytes
}

/** `boundedBody` as text, decoded as `response.text()` decodes it: UTF-8, a byte order mark dropped. */
export async function boundedText(
  response: Response,
  maxBytes: number,
  tooLarge: () => Error,
): Promise<string> {
  return new TextDecoder().decode(await boundedBody(response, maxBytes, tooLarge))
}
