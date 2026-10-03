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

// APP1–APP15 carry EXIF, GPS, XMP, an ICC profile, a maker's notes; COM is free text. APP0 (JFIF) says
// only how the pixels are laid out.
function isMetadata(marker: number): boolean {
  return (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe
}

/**
 * The JPEG without what a camera or an editor writes beside the picture (MOL-167, Р-2): every APP
 * segment but JFIF's, and comments. The phone draws a new JPEG that has none of them, but the API
 * does not take the phone's word — a client changed by hand must not carry where a photo was taken.
 * Everything else, the scan whole, is copied as it was. `null` for what is not a JPEG to walk.
 */
export function withoutMetadata(bytes: Uint8Array): Buffer | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  const kept: Uint8Array[] = [bytes.subarray(0, 2)]
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
      kept.push(bytes.subarray(at, at + 2))
      at += 2
      continue
    }
    // the scan begins: what follows is the picture itself, up to the end, and is kept whole
    if (marker === 0xda) {
      kept.push(bytes.subarray(at))
      return Buffer.concat(kept)
    }
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)
    if (length < 2 || at + 2 + length > bytes.length) return null
    if (!isMetadata(marker)) kept.push(bytes.subarray(at, at + 2 + length))
    at += 2 + length
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
