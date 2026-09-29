import { describe, expect, it, vi } from 'vitest'
import { createBarcodeReader, ReaderFailed, type ReaderWorker } from './barcodeReader'
import type { ReaderReply, ReaderRequest } from './protocol'

function fakeWorker() {
  const messages: ((event: MessageEvent<ReaderReply>) => void)[] = []
  const errors: (() => void)[] = []
  const sent: { request: ReaderRequest; transfer: Transferable[] }[] = []
  const terminate = vi.fn()
  const worker: ReaderWorker = {
    postMessage: (request, transfer) => {
      sent.push({ request, transfer })
    },
    addEventListener: (type: 'message' | 'error', listener: never) => {
      ;(type === 'message' ? messages : errors).push(listener)
    },
    terminate,
  }
  const reply = (data: ReaderReply) => {
    for (const listener of messages) listener(new MessageEvent('message', { data }))
  }
  const crash = () => {
    for (const listener of errors) listener()
  }
  const at = (index: number) => {
    const message = sent[index]
    if (!message) throw new Error(`nothing was sent as message ${String(index)}`)
    return message
  }
  return { worker, sent, at, reply, crash, terminate }
}

const frame = (): ImageData => ({
  data: new Uint8ClampedArray(4 * 4 * 4),
  width: 4,
  height: 4,
  colorSpace: 'srgb',
})

describe('createBarcodeReader', () => {
  it('answers a read with the code the worker found, the pixels moved rather than copied', async () => {
    const { worker, at, reply } = fakeWorker()
    const reader = createBarcodeReader(worker)
    const image = frame()
    const read = reader.read(image)
    const { request, transfer } = at(0)
    expect(request).toMatchObject({ kind: 'read', width: 4, height: 4 })
    expect(transfer).toEqual([image.data.buffer])
    reply({ id: request.id, ok: true, code: '4850000000007' })
    expect(await read).toBe('4850000000007')
  })

  it('answers nothing found as null', async () => {
    const { worker, at, reply } = fakeWorker()
    const read = createBarcodeReader(worker).read(frame())
    reply({ id: at(0).request.id, ok: true, code: null })
    expect(await read).toBeNull()
  })

  it('warms the reader ahead, with nothing to transfer', async () => {
    const { worker, at, reply } = fakeWorker()
    const warm = createBarcodeReader(worker).warm()
    expect(at(0)).toEqual({ request: { id: 0, kind: 'warm' }, transfer: [] })
    reply({ id: 0, ok: true, code: null })
    await expect(warm).resolves.toBeUndefined()
  })

  it('keeps two requests apart by id', async () => {
    const { worker, at, reply } = fakeWorker()
    const reader = createBarcodeReader(worker)
    const warm = reader.warm()
    const read = reader.read(frame())
    reply({ id: at(1).request.id, ok: true, code: '96385074' })
    reply({ id: at(0).request.id, ok: true, code: null })
    expect(await read).toBe('96385074')
    await expect(warm).resolves.toBeUndefined()
  })

  it('fails a request the worker could not do', async () => {
    const { worker, at, reply } = fakeWorker()
    const read = createBarcodeReader(worker).read(frame())
    reply({ id: at(0).request.id, ok: false })
    await expect(read).rejects.toBeInstanceOf(ReaderFailed)
  })

  it('fails every waiting request and every later one once the worker dies', async () => {
    const { worker, sent, crash } = fakeWorker()
    const reader = createBarcodeReader(worker)
    const warm = reader.warm()
    crash()
    await expect(warm).rejects.toBeInstanceOf(ReaderFailed)
    await expect(reader.read(frame())).rejects.toBeInstanceOf(ReaderFailed)
    // Nothing more reaches a dead worker.
    expect(sent).toHaveLength(1)
  })

  it('ends the worker on dispose and fails what was waiting', async () => {
    const { worker, terminate } = fakeWorker()
    const reader = createBarcodeReader(worker)
    const read = reader.read(frame())
    reader.dispose()
    expect(terminate).toHaveBeenCalledOnce()
    await expect(read).rejects.toBeInstanceOf(ReaderFailed)
  })

  it('must not answer a reply it never asked for', async () => {
    const { worker, at, reply } = fakeWorker()
    const read = createBarcodeReader(worker).read(frame())
    reply({ id: 99, ok: true, code: '4850000000007' })
    reply({ id: at(0).request.id, ok: true, code: null })
    expect(await read).toBeNull()
  })
})
