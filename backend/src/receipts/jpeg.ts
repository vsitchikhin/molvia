/**
 * The sides of a JPEG, read from its frame header without decoding a pixel (MOL-125): what the phone
 * sends is checked to be a photo before it is kept, and a file that only calls itself one is
 * refused at once. `null` for anything that is not a baseline or progressive JPEG — and for one with
 * no picture after its headers (review А9): a frame, then the start of the scan, then image data
 * before the end marker. Whether the data decodes is the reader's to find out.
 */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let at = 2
  let size: { width: number; height: number } | null = null
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null
    const marker = bytes[at + 1] ?? 0
    // fill bytes before a marker
    if (marker === 0xff) {
      at += 1
      continue
    }
    // markers that stand alone, with no length
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2
      continue
    }
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)
    if (length < 2) return null
    // a frame header: SOF0–SOF15 but DHT (C4), JPG (C8) and DAC (CC)
    const frame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (frame) {
      if (at + 9 > bytes.length) return null
      const height = ((bytes[at + 5] ?? 0) << 8) | (bytes[at + 6] ?? 0)
      const width = ((bytes[at + 7] ?? 0) << 8) | (bytes[at + 8] ?? 0)
      if (width <= 0 || height <= 0) return null
      size = { width, height }
    }
    if (marker === 0xda) {
      // the scan begins: a frame must have come before it, and data must follow it up to the end
      // marker — a camera may write more after that marker, so the last one is looked for
      const data = at + 2 + length
      return size !== null && lastEnd(bytes) > data ? size : null
    }
    at += 2 + length
  }
  return null
}

// Where the last end-of-image marker stands, or -1.
function lastEnd(bytes: Uint8Array): number {
  for (let i = bytes.length - 2; i >= 0; i--) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return i
  }
  return -1
}
