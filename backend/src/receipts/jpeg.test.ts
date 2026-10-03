import { describe, expect, it } from 'vitest'
import { jpegSize } from './jpeg'

// A JPEG as a camera lays it out: SOI, APP0, the frame header, the start of the scan, its data, EOI.
function jpeg(width: number, height: number, frame = 0xc0, data = 16): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...Array.from({ length: 14 }, () => 0)]
  const sof = [
    0xff,
    frame,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
  ]
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]
  return Uint8Array.from([
    0xff,
    0xd8,
    ...app0,
    ...sof,
    ...Array.from({ length: 9 }, () => 0),
    ...sos,
    ...Array.from({ length: data }, () => 0x55),
    0xff,
    0xd9,
  ])
}

// 16 × 24 grey, written by Pillow: a real file, not a head drawn by hand.
const PILLOW = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/wAALCAAYABABAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/ACiiiiiv/9k=',
  'base64',
)

describe('the sides of a photo', () => {
  it('reads a baseline JPEG: a receipt cropped to 700 × 3 200', () => {
    expect(jpegSize(jpeg(700, 3_200))).toEqual({ width: 700, height: 3_200 })
  })

  it('reads a real file, its tables of codes before the frame', () => {
    expect(jpegSize(PILLOW)).toEqual({ width: 16, height: 24 })
  })

  it('takes data written by a camera after the end marker', () => {
    expect(jpegSize(Uint8Array.from([...jpeg(700, 3_200), 0x00, 0x11, 0x22]))).toEqual({
      width: 700,
      height: 3_200,
    })
  })

  it('refuses a head with no picture: no scan, or a scan with nothing in it (review А9)', () => {
    const head = jpeg(1_000, 3_000).slice(0, 2 + 18 + 19)
    expect(jpegSize(Uint8Array.from([...head, 0xff, 0xd9]))).toBeNull()
    expect(jpegSize(jpeg(1_000, 3_000, 0xc0, 0))).toBeNull()
    expect(jpegSize(PILLOW.subarray(0, PILLOW.length - 2))).toBeNull()
  })

  it('reads a progressive one', () => {
    expect(jpegSize(jpeg(1_000, 2_000, 0xc2))).toEqual({ width: 1_000, height: 2_000 })
  })

  it('refuses what only starts like one, text, an empty file and a PNG', () => {
    expect(jpegSize(Uint8Array.from([0xff, 0xd8]))).toBeNull()
    expect(jpegSize(new TextEncoder().encode('not a photo'))).toBeNull()
    expect(jpegSize(new Uint8Array())).toBeNull()
    expect(jpegSize(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull()
  })

  it('refuses a frame of no size', () => {
    expect(jpegSize(jpeg(0, 100))).toBeNull()
  })

  it('does not take a table of codes (DHT) for the frame', () => {
    expect(jpegSize(jpeg(700, 3_200, 0xc4))).toBeNull()
  })
})
