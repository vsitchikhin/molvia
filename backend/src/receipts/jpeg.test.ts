import { describe, expect, it } from 'vitest'
import { jpegSize } from './jpeg'

// A JPEG's head as a camera writes it: SOI, an APP0 segment, then the frame header SOF0.
function jpeg(width: number, height: number, frame = 0xc0): Uint8Array {
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
  return Uint8Array.from([
    0xff,
    0xd8,
    ...app0,
    ...sof,
    ...Array.from({ length: 9 }, () => 0),
    0xff,
    0xd9,
  ])
}

describe('the sides of a photo', () => {
  it('reads a baseline JPEG: a receipt cropped to 700 × 3 200', () => {
    expect(jpegSize(jpeg(700, 3_200))).toEqual({ width: 700, height: 3_200 })
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
