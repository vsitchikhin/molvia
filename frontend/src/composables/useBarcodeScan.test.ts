import { effectScope, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useBarcodeScan } from '@/composables/useBarcodeScan'
import { ReaderFailed, type BarcodeReader } from '@/scanner/barcodeReader'
import type { FrameSource } from '@/scanner/capture'

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

  it('ends the reader with its scope', () => {
    const { reader, dispose } = fakeReader([])
    const { scope, scan } = scanWith(reader)
    scan.warm()
    scope.stop()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
