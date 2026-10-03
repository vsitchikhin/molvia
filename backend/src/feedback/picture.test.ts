import { describe, expect, it } from 'vitest'
import {
  ERROR,
  FEEDBACK_PICTURE_BYTES_MAX,
  FEEDBACK_PICTURE_SIDE_MAX,
  FEEDBACK_PICTURE_SIDE_MIN,
} from '@molvia/model'
import { jpegSize } from '@/receipts/jpeg'
import { pictureOf, withoutMetadata } from './picture'

const segment = (marker: number, body: number[]) => [
  0xff,
  marker,
  (body.length + 2) >> 8,
  (body.length + 2) & 0xff,
  ...body,
]
const ascii = (text: string) => [...Buffer.from(text, 'latin1')]

// EXIF with a GPS block, as a phone's camera writes it: what must not reach the base.
const EXIF = segment(0xe1, [...ascii('Exif\0\0GPS 40.7942N 43.8453E'), 0x00])
const XMP = segment(0xe1, ascii('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>'))
const ICC = segment(0xe2, ascii('ICC_PROFILE\0'))
const COMMENT = segment(0xfe, ascii('Gyumri, 3 October'))
const JFIF = segment(0xe0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0])

function jpeg(width: number, height: number, extra: number[][] = []): Buffer {
  const sof = segment(0xc0, [0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01])
  const sos = segment(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])
  return Buffer.from([
    0xff,
    0xd8,
    ...JFIF,
    ...extra.flat(),
    ...segment(
      0xdb,
      Array.from({ length: 65 }, () => 1),
    ),
    ...sof,
    ...sos,
    // the scan's data, with a byte that looks like a marker escaped as JPEG escapes it
    ...[0x55, 0xff, 0x00, 0x55, 0x55],
    0xff,
    0xd9,
  ])
}

const contains = (haystack: Buffer, needle: string) =>
  haystack.includes(Buffer.from(needle, 'latin1'))

describe('withoutMetadata — снимок без того, что пишут рядом с картинкой (MOL-167, Р-2)', () => {
  it('убирает EXIF с местом съёмки, XMP, профиль и комментарий', () => {
    const dirty = jpeg(1179, 2556, [EXIF, XMP, ICC, COMMENT])
    const clean = withoutMetadata(dirty)
    expect(clean).not.toBeNull()
    for (const trace of ['GPS', 'Exif', 'xmpmeta', 'ICC_PROFILE', 'Gyumri']) {
      expect({ trace, left: contains(clean ?? Buffer.alloc(0), trace) }).toEqual({
        trace,
        left: false,
      })
    }
  })

  it('картинку не трогает: без метаданных файл тот же байт в байт', () => {
    const plain = jpeg(1179, 2556)
    expect(withoutMetadata(plain)?.equals(plain)).toBe(true)
    const clean = withoutMetadata(jpeg(1179, 2556, [EXIF, COMMENT]))
    expect(clean?.equals(plain)).toBe(true)
    expect(jpegSize(clean ?? Buffer.alloc(0))).toEqual({ width: 1179, height: 2556 })
  })

  it('не JPEG и оборванный сегмент — null', () => {
    expect(withoutMetadata(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'))).toBeNull()
    expect(withoutMetadata(jpeg(100, 100).subarray(0, 12))).toBeNull()
  })
})

describe('pictureOf — снимок, каким он хранится', () => {
  const base64 = (bytes: Buffer) => bytes.toString('base64')

  it('чистый, со сторонами, размером и отпечатком самих хранимых байтов', () => {
    const picture = pictureOf(base64(jpeg(1179, 2556, [EXIF])))
    expect(picture).toMatchObject({ width: 1179, height: 2556 })
    expect(contains(picture.image, 'GPS')).toBe(false)
    expect(picture.bytes).toBe(picture.image.length)
    // Один снимок с метаданными и без — один и тот же снимок: повтор узнаётся по картинке.
    expect(picture.fingerprint).toBe(pictureOf(base64(jpeg(1179, 2556))).fingerprint)
    expect(picture.fingerprint).not.toBe(pictureOf(base64(jpeg(1180, 2556))).fingerprint)
  })

  it('стороны на границах: 100 и 4000 — да, 99 и 4001 — нет', () => {
    const min = FEEDBACK_PICTURE_SIDE_MIN
    const max = FEEDBACK_PICTURE_SIDE_MAX
    expect(pictureOf(base64(jpeg(min, min))).width).toBe(min)
    expect(pictureOf(base64(jpeg(max, 1000))).width).toBe(max)
    for (const [width, height] of [
      [min - 1, 500],
      [max + 1, 1000],
    ] as const) {
      expect(() => pictureOf(base64(jpeg(width, height)))).toThrow(
        expect.objectContaining({ code: ERROR.FEEDBACK_PICTURE_INVALID }),
      )
    }
  })

  it('длиннее двадцати ширин — нет: Telegram такое фото не примет', () => {
    expect(pictureOf(base64(jpeg(150, 3000))).height).toBe(3000)
    expect(() => pictureOf(base64(jpeg(149, 3000)))).toThrow(
      expect.objectContaining({ code: ERROR.FEEDBACK_PICTURE_INVALID }),
    )
  })

  it('не JPEG — «не подошёл», больше предела — «слишком большой»', () => {
    expect(() => pictureOf(Buffer.from('GIF89a').toString('base64'))).toThrow(
      expect.objectContaining({ code: ERROR.FEEDBACK_PICTURE_INVALID }),
    )
    const huge = Buffer.concat([
      jpeg(1000, 1000),
      Buffer.alloc(FEEDBACK_PICTURE_BYTES_MAX),
    ]).toString('base64')
    expect(() => pictureOf(huge)).toThrow(
      expect.objectContaining({ code: ERROR.FEEDBACK_PICTURE_TOO_LARGE }),
    )
  })
})

describe('метаданные в любом месте файла (ревью 1, адверсариальное А2)', () => {
  const sof2 = (width: number, height: number) =>
    segment(0xc2, [0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01])
  const sos = segment(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])
  // Entropy-coded data with a stuffed 0xFF and a restart marker in it: neither is a segment.
  const scan = [0x55, 0xff, 0x00, 0x55, 0xff, 0xd0, 0x55]

  it('между сканами прогрессивного JPEG — вырезаются, сканы целы', () => {
    const progressive = Buffer.from([
      0xff,
      0xd8,
      ...JFIF,
      ...sof2(1179, 2556),
      ...sos,
      ...scan,
      ...EXIF,
      ...COMMENT,
      ...sos,
      ...scan,
      0xff,
      0xd9,
    ])

    const clean = withoutMetadata(progressive) ?? Buffer.alloc(0)

    expect(contains(clean, 'GPS')).toBe(false)
    expect(contains(clean, 'Gyumri')).toBe(false)
    expect(clean).toEqual(
      Buffer.from([
        0xff,
        0xd8,
        ...JFIF,
        ...sof2(1179, 2556),
        ...sos,
        ...scan,
        ...sos,
        ...scan,
        0xff,
        0xd9,
      ]),
    )
    expect(jpegSize(clean)).toEqual({ width: 1179, height: 2556 })
  })

  it('после конца картинки — ничего: ни второго JPEG со своим EXIF (MPF, Ultra HDR), ни хвоста', () => {
    const primary = jpeg(1179, 2556)
    const secondary = jpeg(295, 639, [EXIF])
    const tail = Buffer.from('+374 99 123456', 'latin1')

    expect(withoutMetadata(Buffer.concat([primary, secondary]))?.equals(primary)).toBe(true)
    expect(withoutMetadata(Buffer.concat([primary, tail]))?.equals(primary)).toBe(true)
  })

  it('APP0 — только JFIF и без миниатюры; JFXX — вон', () => {
    const thumbnail = segment(0xe0, [
      ...ascii('JFIF\0'),
      1,
      1,
      0,
      0,
      1,
      0,
      1,
      2,
      1,
      9,
      9,
      9,
      9,
      9,
      9,
    ])
    const jfxx = segment(0xe0, [...ascii('JFXX\0'), 0x10, ...ascii('a thumbnail of the photo')])
    const sof = segment(0xc0, [0x08, 0x01, 0x00, 0x01, 0x00, 0x01])
    const body = [...sof, ...sos, 0x55, 0xff, 0xd9]

    const withThumbnail = withoutMetadata(Buffer.from([0xff, 0xd8, ...thumbnail, ...body]))
    expect(withThumbnail).toEqual(Buffer.from([0xff, 0xd8, ...JFIF, ...body]))
    const withJfxx = withoutMetadata(Buffer.from([0xff, 0xd8, ...JFIF, ...jfxx, ...body]))
    expect(withJfxx).toEqual(Buffer.from([0xff, 0xd8, ...JFIF, ...body]))
  })

  it('без конца картинки или со вторым началом внутри — не JPEG', () => {
    const open = jpeg(100, 100).subarray(0, -2)
    expect(withoutMetadata(Buffer.concat([open, Buffer.from([0x55, 0x55])]))).toBeNull()
    const nested = Buffer.from([0xff, 0xd8, 0xff, 0xd8, ...jpeg(100, 100).subarray(2)])
    expect(withoutMetadata(nested)).toBeNull()
  })
})

describe('потолок разбора (адверсариальное А3)', () => {
  /** Two megabytes of empty four-byte segments before the frame. */
  function crowded(): Buffer {
    const head = [0xff, 0xd8]
    const tail = [
      ...segment(0xc0, [0x08, 0x03, 0xe8, 0x03, 0xe8, 0x01]),
      ...segment(0xda, [0x01, 0x01, 0, 0, 0x3f, 0]),
      0x55,
      0xff,
      0xd9,
    ]
    const count = Math.floor((FEEDBACK_PICTURE_BYTES_MAX - head.length - tail.length) / 4)
    const bytes = Buffer.alloc(head.length + count * 4 + tail.length)
    bytes.set(head, 0)
    for (let at = 0; at < count; at++) bytes.set([0xff, 0xdb, 0x00, 0x02], 2 + at * 4)
    bytes.set(tail, 2 + count * 4)
    return bytes
  }

  it('больше 256 сегментов — «не подошёл», не пройдя файл до конца', () => {
    const encoded = crowded().toString('base64')
    const timed = () => {
      const started = performance.now()
      expect(() => pictureOf(encoded)).toThrow(
        expect.objectContaining({ code: ERROR.FEEDBACK_PICTURE_INVALID }),
      )
      return performance.now() - started
    }
    // The fastest of five: other copies' load on this machine only ever adds time. The base64 of two
    // megabytes is most of what is left.
    expect(Math.min(...Array.from({ length: 5 }, timed))).toBeLessThan(15)
  })
})
