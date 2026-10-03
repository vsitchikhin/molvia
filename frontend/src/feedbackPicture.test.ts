import { describe, expect, it, vi } from 'vitest'
import { FEEDBACK_PICTURE_BYTES_MAX, FEEDBACK_PICTURE_SIDE } from '@molvia/model'
import type { Drawing } from './feedbackPicture'
import { PictureRefused, base64Of, pictureFromFile } from './feedbackPicture'

/** A drawing of a picture this size, whose JPEG weighs what `weigh` says for each attempt. */
function drawing(width: number, height: number, weigh: (quality: number, w: number) => number) {
  const close = vi.fn()
  const jpeg = vi.fn((_: unknown, w: number, _h: number, quality: number) =>
    Promise.resolve(new Blob([new Uint8Array(weigh(quality, w))], { type: 'image/jpeg' })),
  )
  const made: Drawing = { open: () => Promise.resolve({ width, height, close }), jpeg }
  return { made, jpeg, close }
}

const light = () => 300_000
const file = new Blob(['x'])

describe('pictureFromFile — снимок, перерисованный заново (MOL-167, Р-1)', () => {
  it('скриншот телефона — как есть, одна попытка, JPEG 0.85', async () => {
    const { made, jpeg, close } = drawing(1179, 2556, light)

    const picture = await pictureFromFile(file, made)

    expect(picture).toMatchObject({ width: 1179, height: 2556 })
    expect(jpeg.mock.calls.map((call) => call.slice(1))).toEqual([[1179, 2556, 0.85]])
    expect(close).toHaveBeenCalledOnce()
  })

  it('длинная сторона больше 2560 — вписывается, пропорции те же', async () => {
    const { made } = drawing(4032, 3024, light)

    const picture = await pictureFromFile(file, made)

    expect(picture).toEqual(expect.objectContaining({ width: FEEDBACK_PICTURE_SIDE, height: 1920 }))
  })

  it('тяжелее предела — тише качество, потом меньше сторона', async () => {
    const heavy = (quality: number, width: number) =>
      quality === 0.7 && width < 1179 ? 900_000 : FEEDBACK_PICTURE_BYTES_MAX + 1
    const { made, jpeg } = drawing(1179, 2556, heavy)

    const picture = await pictureFromFile(file, made)

    expect(jpeg.mock.calls.map((call) => [call[1], call[3]])).toEqual([
      [1179, 0.85],
      [1179, 0.7],
      [884, 0.7],
    ])
    expect(picture.width).toBe(884)
  })

  it('длиннее двадцати ширин — «не та форма», и ничего не рисуется', async () => {
    const { made, jpeg, close } = drawing(100, 2100, light)

    await expect(pictureFromFile(file, made)).rejects.toEqual(new PictureRefused('shape'))
    expect(jpeg).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })

  it('браузер не открыл файл — «не открылась»', async () => {
    const made: Drawing = {
      open: () => Promise.reject(new DOMException('HEIC', 'InvalidStateError')),
      jpeg: vi.fn(),
    }

    await expect(pictureFromFile(file, made)).rejects.toMatchObject({ reason: 'unreadable' })
  })

  it('base64 — байты как есть', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])

    expect(await base64Of(new Blob([bytes]))).toBe('/9j/2Q==')
  })
})
