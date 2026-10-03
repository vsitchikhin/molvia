import { createHash } from 'node:crypto'
import {
  DomainError,
  ERROR,
  FEEDBACK_PICTURE_BYTES_MAX,
  FEEDBACK_PICTURE_RATIO_MAX,
  FEEDBACK_PICTURE_SIDE_MAX,
  FEEDBACK_PICTURE_SIDE_MIN,
} from '@molvia/model'
import { jpegSize } from '@/receipts/jpeg'

/** A picture of a message as it is kept until the owner has it (MOL-167). */
export interface PictureIn {
  readonly image: Buffer
  /** The sha256 of the bytes kept: the same picture sent again is the same message. */
  readonly fingerprint: string
  readonly bytes: number
  readonly width: number
  readonly height: number
}

// APP1–APP15 carry EXIF, GPS, XMP, an ICC profile, a maker's notes; COM is free text.
function isMetadata(marker: number): boolean {
  return (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe
}

/**
 * How many marker segments a picture may have. A real JPEG has a dozen or two — a progressive one,
 * scans and tables, a few dozen; two megabytes of empty four-byte segments held the API's thread for
 * a hundred milliseconds a picture (adversarial А3).
 */
const SEGMENTS_MAX = 256

const JFIF = [0x4a, 0x46, 0x49, 0x46, 0x00]

/**
 * JFIF's APP0 as it says how the pixels are laid out and nothing else: version, units, density, and
 * no thumbnail (review 1). Any other APP0 — a JFXX extension with its own picture — is left out.
 */
function plainJfif(payload: Uint8Array): Uint8Array | null {
  if (payload.length < 14 || JFIF.some((byte, at) => payload[at] !== byte)) return null
  return Uint8Array.from([0xff, 0xe0, 0x00, 0x10, ...payload.subarray(0, 12), 0x00, 0x00])
}

/** Where the entropy-coded data after `from` ends: the first marker that is not a stuffed 0xFF or a restart. */
function scanEnd(bytes: Uint8Array, from: number): number {
  let at = bytes.indexOf(0xff, from)
  while (at !== -1 && at + 1 < bytes.length) {
    const next = bytes[at + 1] ?? 0
    if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7)) return at
    at = bytes.indexOf(0xff, at + 2)
  }
  return -1
}

/**
 * The JPEG with nothing but the picture (MOL-167, Р-2): every segment is walked — between the scans
 * of a progressive JPEG too, the entropy-coded data skipped by its stuffed bytes and restarts — and
 * every APP segment but a plain JFIF and every comment is left out wherever it stands; whatever comes
 * after the end of the picture — a second JPEG of MPF or Ultra HDR with its own EXIF, any tail — is
 * cut (review 1, adversarial А2). The phone draws a new JPEG, but the API does not take its word: a
 * client changed by hand must not carry where a photo was taken. `null` for what is not a JPEG to
 * walk whole, or one of more than `SEGMENTS_MAX` segments.
 */
export function withoutMetadata(bytes: Uint8Array): Buffer | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  const kept: Uint8Array[] = [bytes.subarray(0, 2)]
  let at = 2
  let segments = 0
  let scanned = false
  while (at + 2 <= bytes.length) {
    if (bytes[at] !== 0xff) return null
    const marker = bytes[at + 1] ?? 0
    // fill bytes before a marker
    if (marker === 0xff) {
      at += 1
      continue
    }
    // the end of the picture: kept, and nothing after it
    if (marker === 0xd9) {
      if (!scanned) return null
      kept.push(bytes.subarray(at, at + 2))
      return Buffer.concat(kept)
    }
    // a second start inside the first is no picture to walk
    if (marker === 0xd8) return null
    // markers that stand alone, with no length
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(bytes.subarray(at, at + 2))
      at += 2
      continue
    }
    segments += 1
    if (segments > SEGMENTS_MAX || at + 4 > bytes.length) return null
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)
    const end = at + 2 + length
    if (length < 2 || end > bytes.length) return null
    if (marker === 0xe0) {
      const jfif = plainJfif(bytes.subarray(at + 4, end))
      if (jfif !== null) kept.push(jfif)
    } else if (!isMetadata(marker)) {
      kept.push(bytes.subarray(at, end))
    }
    at = end
    if (marker === 0xda) {
      const data = scanEnd(bytes, at)
      if (data === -1) return null
      kept.push(bytes.subarray(at, data))
      at = data
      scanned = true
    }
  }
  return null
}

/**
 * One picture of a message, as the phone sent it in base64, made into what is kept (MOL-167, Р-2):
 * no more than `FEEDBACK_PICTURE_BYTES_MAX`, a JPEG by its frame, stripped of its metadata, with
 * sides the owner's Telegram takes. A refusal names the picture's fault, never the message's.
 */
export function pictureOf(encoded: string): PictureIn {
  const raw = Buffer.from(encoded, 'base64')
  if (raw.length > FEEDBACK_PICTURE_BYTES_MAX) {
    throw new DomainError(ERROR.FEEDBACK_PICTURE_TOO_LARGE)
  }
  const image = withoutMetadata(raw)
  const size = image === null ? null : jpegSize(image)
  if (image === null || size === null) throw new DomainError(ERROR.FEEDBACK_PICTURE_INVALID)
  const { width, height } = size
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  if (
    short < FEEDBACK_PICTURE_SIDE_MIN ||
    long > FEEDBACK_PICTURE_SIDE_MAX ||
    long > short * FEEDBACK_PICTURE_RATIO_MAX
  ) {
    throw new DomainError(ERROR.FEEDBACK_PICTURE_INVALID)
  }
  return {
    image,
    fingerprint: createHash('sha256').update(image).digest('hex'),
    bytes: image.length,
    width,
    height,
  }
}
