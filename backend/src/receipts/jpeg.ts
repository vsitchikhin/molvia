/**
 * The sides of a JPEG, read from its frame header without decoding a pixel (MOL-125): what the phone
 * sends is checked to be a photo before it is kept, and a file that only calls itself one is
 * refused at once. `null` for anything that is not a baseline or progressive JPEG.
 */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let at = 2
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
      return width > 0 && height > 0 ? { width, height } : null
    }
    // the image data begins and no frame came before it
    if (marker === 0xda) return null
    at += 2 + length
  }
  return null
}
