import { effectScope, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useBarcodeScan } from '@/composables/useBarcodeScan'
import { reportFailure } from '@/failures'
import { ReaderFailed, type BarcodeReader } from '@/scanner/barcodeReader'
import type { FrameSource } from '@/scanner/capture'

vi.mock('@/failures', () => ({ reportFailure: vi.fn() }))

const image = (): ImageData => ({
  data: new Uint8ClampedArray(4),
  width: 1,
  height: 1,
  colorSpace: 'srgb',
})

/** A reader that answers each read with the next of `codes`, and counts the reads. */
function fakeReader(codes: (string | null | ReaderFailed)[]) {
  const reads = { count: 0 }
  const dispose = vi.fn()
  const reader: BarcodeReader = {
    warm: () => Promise.resolve(),
    read: () => {
      const code = codes[reads.count++]
      if (code === undefined) return new Promise(() => undefined)
      return code instanceof ReaderFailed ? Promise.reject(code) : Promise.resolve(code)
    },
    dispose,
  }
  return { reader, reads, dispose }
}

const frames = (grab: () => ImageData | null = image): FrameSource => ({
  next: () => Promise.resolve(),
  grab,
})

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await nextTick()
}

function scanWith(reader: BarcodeReader, source: FrameSource | null = frames()) {
  const live = ref(false)
  const onCode = vi.fn()
  const scope = effectScope()
  const scan = scope.run(() =>
    useBarcodeScan({ live, frames: () => source, onCode, createReader: () => reader }),
  )
  if (!scan) throw new Error('no scan')
  return { live, onCode, scope, scan }
}

describe('useBarcodeScan', () => {
  it('hands over a code once two frames in a row agree, and reads no further', async () => {
    const { reader, reads } = fakeReader([null, '4850000000007', '4850000000007', '96385074'])
    const { live, onCode } = scanWith(reader)
    live.value = true
    await settle()
    expect(onCode).toHaveBeenCalledExactlyOnceWith('4850000000007')
    expect(reads.count).toBe(3)
  })

  it('must not read while the camera is not live', async () => {
    const { reader, reads } = fakeReader(['4850000000007', '4850000000007'])
    scanWith(reader)
    await settle()
    expect(reads.count).toBe(0)
  })

  it('stops reading when the camera stops', async () => {
    let release: (() => void) | undefined
    const source: FrameSource = {
      next: () => new Promise((resolve) => (release = resolve)),
      grab: image,
    }
    const { reader, reads } = fakeReader(['4850000000007', '4850000000007'])
    const { live, onCode } = scanWith(reader, source)
    live.value = true
    await settle()
    live.value = false
    await nextTick()
    release?.()
    await settle()
    expect(reads.count).toBe(0)
    expect(onCode).not.toHaveBeenCalled()
  })

  it('skips a frame with no pixels without reading it', async () => {
    let calls = 0
    const { reader, reads } = fakeReader(['96385074', '96385074'])
    const { live, onCode } = scanWith(
      reader,
      frames(() => (calls++ === 0 ? null : image())),
    )
    live.value = true
    await settle()
    expect(reads.count).toBe(2)
    expect(onCode).toHaveBeenCalledWith('96385074')
  })

  it('fails once the reader fails, and reads again after a reset and a new start', async () => {
    const { reader } = fakeReader([new ReaderFailed()])
    const second = fakeReader(['96385074', '96385074'])
    let made = 0
    const live = ref(false)
    const onCode = vi.fn()
    const scope = effectScope()
    const scan = scope.run(() =>
      useBarcodeScan({
        live,
        frames: () => frames(),
        onCode,
        createReader: () => (made++ === 0 ? reader : second.reader),
      }),
    )
    live.value = true
    await settle()
    expect(scan?.failed.value).toBe(true)
    scan?.reset()
    live.value = false
    await nextTick()
    live.value = true
    await settle()
    expect(scan?.failed.value).toBe(false)
    expect(onCode).toHaveBeenCalledWith('96385074')
  })

  it('fails when the reader will not load', async () => {
    const reader: BarcodeReader = {
      warm: () => Promise.reject(new ReaderFailed()),
      read: () => Promise.resolve(null),
      dispose: vi.fn(),
    }
    const { scan } = scanWith(reader)
    scan.warm()
    await settle()
    expect(scan.failed.value).toBe(true)
  })

  it('draws a frame that could not be cut as the reader’s error, not as silence (adversarial Е)', async () => {
    let frames = 0
    const source: FrameSource = {
      next: () => Promise.resolve(),
      grab: () => {
        if (++frames === 2) throw new TypeError('getImageData: Value is not of type long')
        return image()
      },
    }
    const { reader } = fakeReader([null])
    const { live, scan } = scanWith(reader, source)
    live.value = true
    await settle()
    expect(scan.failed.value).toBe(true)
  })

  it('must not take a read of another shape than a barcode’s, however often it agrees', async () => {
    const { reader } = fakeReader(['12345', '12345', '96385074', '96385074'])
    const { live, onCode } = scanWith(reader)
    live.value = true
    await settle()
    expect(onCode).toHaveBeenCalledExactlyOnceWith('96385074')
  })

  it('must not fail the new reader over the warm the reset one gave up (adversarial Б)', async () => {
    let giveUp: (() => void) | undefined
    const first: BarcodeReader = {
      warm: () =>
        new Promise(
          (_, reject) =>
            (giveUp = () => {
              reject(new ReaderFailed())
            }),
        ),
      read: () => new Promise(() => undefined),
      dispose: () => giveUp?.(),
    }
    const second = fakeReader([])
    let made = 0
    const live = ref(false)
    const scope = effectScope()
    const scan = scope.run(() =>
      useBarcodeScan({
        live,
        frames: () => frames(),
        onCode: vi.fn(),
        createReader: () => (made++ === 0 ? first : second.reader),
      }),
    )
    scan?.warm()
    // A retry while the first reader still loads: it is let go and its warm rejects.
    scan?.reset()
    scan?.warm()
    await settle()
    expect(scan?.failed.value).toBe(false)
  })

  it('ends the reader with its scope', () => {
    const { reader, dispose } = fakeReader([])
    const { scope, scan } = scanWith(reader)
    scan.warm()
    scope.stop()
    expect(dispose).toHaveBeenCalledOnce()
  })
})

describe("the reader's failure is reported (MOL-144, Р-11)", () => {
  it("as the scanner's, by what failed in the worker", async () => {
    const cause = new Error('unreachable')
    cause.name = 'RuntimeError'
    const { reader } = fakeReader([new ReaderFailed(cause)])
    const { live } = scanWith(reader)
    live.value = true
    await settle()
    expect(reportFailure).toHaveBeenLastCalledWith(cause, 'scanner')
  })

  it("and a throw of the page's own step as it was thrown", async () => {
    vi.mocked(reportFailure).mockClear()
    const broken = new TypeError('no crop')
    const { reader } = fakeReader(['4850000000007'])
    const { live } = scanWith(
      reader,
      frames(() => {
        throw broken
      }),
    )
    live.value = true
    await settle()
    expect(reportFailure).toHaveBeenCalledExactlyOnceWith(broken, 'scanner')
  })
})
