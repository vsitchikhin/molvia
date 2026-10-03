import {
  FEEDBACK_PICTURE_BYTES_MAX,
  FEEDBACK_PICTURE_RATIO_MAX,
  FEEDBACK_PICTURE_SIDE,
  FEEDBACK_PICTURE_SIDE_MIN,
} from '@molvia/model'

/** A picture drawn anew for a message to the developer: exactly what the sheet shows and sends. */
export interface DrawnPicture {
  readonly jpeg: Blob
  readonly width: number
  readonly height: number
}

/**
 * Why a picture from the gallery cannot go: the browser could not open it (an HEIC an old Android
 * hands over, a file that only calls itself a picture), or it is a shape Telegram refuses — a
 * scrolled capture twenty screens long, a strip too narrow to show anything.
 */
export type PictureRefusal = 'unreadable' | 'shape'

export class PictureRefused extends Error {
  constructor(readonly reason: PictureRefusal) {
    super(`picture refused: ${reason}`)
    this.name = 'PictureRefused'
  }
}

/** What a picture is drawn with: the browser's own, replaced in tests where there is no canvas. */
export interface Drawing {
  open(file: Blob): Promise<{ width: number; height: number; close(): void }>
  jpeg(
    picture: { width: number; height: number },
    width: number,
    height: number,
    quality: number,
  ): Promise<Blob>
}

const browserDrawing: Drawing = {
  // The EXIF orientation is applied while decoding, before the EXIF is gone with the redraw.
  open: async (file) => createImageBitmap(file, { imageOrientation: 'from-image' }),
  jpeg: async (picture, width, height, quality) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (context === null) throw new PictureRefused('unreadable')
    context.drawImage(picture as CanvasImageSource, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', quality)
    })
    if (blob === null) throw new PictureRefused('unreadable')
    return blob
  },
}

/** The drawings tried in turn until one fits the API's limit: a screenshot fits the first. */
const ATTEMPTS = [
  { scale: 1, quality: 0.85 },
  { scale: 1, quality: 0.7 },
  { scale: 0.75, quality: 0.7 },
  { scale: 0.5, quality: 0.7 },
] as const

/**
 * A picture from the gallery drawn anew as a JPEG (MOL-167, Р-1): its longest side at most
 * `FEEDBACK_PICTURE_SIDE` — Telegram shrinks a photo anyway — and nothing of the file but the pixels.
 * A canvas writes no EXIF, no place of shooting, no profile; the API strips them again regardless.
 * A PNG screenshot comes out a few times lighter. What it returns is what the sheet shows before
 * sending and what goes — never the file as chosen.
 */
export async function pictureFromFile(
  file: Blob,
  drawing: Drawing = browserDrawing,
): Promise<DrawnPicture> {
  let picture: Awaited<ReturnType<Drawing['open']>>
  try {
    picture = await drawing.open(file)
  } catch {
    throw new PictureRefused('unreadable')
  }
  try {
    const long = Math.max(picture.width, picture.height)
    const short = Math.min(picture.width, picture.height)
    if (short === 0 || long > short * FEEDBACK_PICTURE_RATIO_MAX) {
      throw new PictureRefused('shape')
    }
    for (const { scale, quality } of ATTEMPTS) {
      const fit = Math.min(1, FEEDBACK_PICTURE_SIDE / long) * scale
      const width = Math.round(picture.width * fit)
      const height = Math.round(picture.height * fit)
      if (Math.min(width, height) < FEEDBACK_PICTURE_SIDE_MIN) throw new PictureRefused('shape')
      const jpeg = await drawing.jpeg(picture, width, height, quality)
      if (jpeg.size <= FEEDBACK_PICTURE_BYTES_MAX) return { jpeg, width, height }
    }
    throw new PictureRefused('unreadable')
  } finally {
    picture.close()
  }
}

/** A drawn picture as the body carries it. */
export async function base64Of(jpeg: Blob): Promise<string> {
  const bytes = new Uint8Array(await jpeg.arrayBuffer())
  let binary = ''
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  }
  return btoa(binary)
}
