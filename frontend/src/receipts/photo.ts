import { RECEIPT_PART_BYTES_MAX, RECEIPT_SIDE_MIN } from '@molvia/model'

/**
 * A photo of a receipt made ready on the phone, before it is queued (MOL-127, Т-2): turned upright by
 * its EXIF, brought down to what is sent, and re-encoded as JPEG — which leaves the EXIF, the place it
 * was taken included, behind: a canvas carries none of it.
 *
 * **The long side is at most `RECEIPT_PHOTO_SIDE`** (MOL-114, П-7): the reader wants the receipt at
 * full resolution, and a long one is about 700 × 3 200 once cut out; more only weighs on the upload.
 * The server refuses past `RECEIPT_SIDE_MAX` and below `RECEIPT_SIDE_MIN`.
 */
export const RECEIPT_PHOTO_SIDE = 3200

/** What JPEG keeps of the print: the reader loses the thin strokes of a till's font below it. */
export const RECEIPT_PHOTO_QUALITY = 0.9

/**
 * The most pixels a canvas is drawn with (Р-11): iOS refuses a canvas over 16 777 216, and a camera
 * of an iPhone 15 or 16 takes 24 Mp by default. A photo above it is brought down as it is decoded.
 */
export const CANVAS_PIXELS_MAX = 16_000_000

export interface Size {
  readonly width: number
  readonly height: number
}

export type PreparedPhoto =
  { readonly ok: true; readonly photo: Blob; readonly size: Size } | { readonly ok: false }

/** The size a picture is brought to so that neither its long side nor its area passes the limits. */
export function fittedSize(size: Size, longSide: number, pixels = CANVAS_PIXELS_MAX): Size {
  const { width, height } = size
  const byLong = longSide / Math.max(width, height)
  const byArea = Math.sqrt(pixels / (width * height))
  const scale = Math.min(1, byLong, byArea)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Whether the server would take a part of this size and weight (MOL-125 Т-2): else «не открылся». */
export function sendable(size: Size, bytes: number): boolean {
  return Math.min(size.width, size.height) >= RECEIPT_SIDE_MIN && bytes <= RECEIPT_PART_BYTES_MAX
}

function canvasOf(size: Size): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  return canvas
}

function jpegOf(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', RECEIPT_PHOTO_QUALITY)
  })
}

/**
 * Decodes a file picked or taken, upright by its EXIF (`from-image`, the default of every engine
 * that has the option), and draws it at most `CANVAS_PIXELS_MAX` big. Null — not a picture this
 * browser can open (4g).
 */
export async function decodePhoto(file: Blob): Promise<HTMLCanvasElement | null> {
  if (file.type !== '' && !file.type.startsWith('image/')) return null
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return null
  }
  try {
    const size = fittedSize({ width: bitmap.width, height: bitmap.height }, Infinity)
    const canvas = canvasOf(size)
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(bitmap, 0, 0, size.width, size.height)
    return canvas
  } finally {
    bitmap.close()
  }
}

/** The picture brought to `RECEIPT_PHOTO_SIDE` and encoded as it is sent. */
export async function encodePhoto(source: HTMLCanvasElement): Promise<PreparedPhoto> {
  const size = fittedSize({ width: source.width, height: source.height }, RECEIPT_PHOTO_SIDE)
  let canvas = source
  if (size.width !== source.width || size.height !== source.height) {
    canvas = canvasOf(size)
    const context = canvas.getContext('2d')
    if (!context) return { ok: false }
    context.imageSmoothingQuality = 'high'
    context.drawImage(source, 0, 0, size.width, size.height)
  }
  const photo = await jpegOf(canvas)
  if (!photo || !sendable(size, photo.size)) return { ok: false }
  return { ok: true, photo, size }
}

/** A file made ready as a part, whole frame. */
export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  const canvas = await decodePhoto(file)
  return canvas ? encodePhoto(canvas) : { ok: false }
}
