import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ApiError } from '@molvia/client'
import { ERROR, ISSUE, parseMoney, parseQuantity } from '@molvia/model'
import type {
  ReceiptBody,
  ReceiptLinkBody,
  ReceiptPhotoBody,
  ReceiptRecordBody,
} from '@molvia/model'
import type { PhotoShelf } from '@/receipts/photoShelf'
import { useActorStore } from '@/stores/actor'
import { useReceiptQueueStore } from '@/stores/receiptQueue'

const sendReceipt = vi.fn<(body: ReceiptBody) => Promise<unknown>>()
const putReceiptPart = vi.fn<(id: string, part: number, photo: Blob) => Promise<unknown>>()
const removeReceipt = vi.fn<(id: string) => Promise<void>>()
const restoreReceipt = vi.fn<(id: string) => Promise<unknown>>()
const recordReceipt = vi.fn<(id: string, body: ReceiptRecordBody) => Promise<{ tripId: string }>>()
const calls: string[] = []
vi.mock('@/api', () => ({
  api: {
    sendReceipt: (body: ReceiptBody) => (calls.push(`create ${body.id}`), sendReceipt(body)),
    putReceiptPart: (id: string, part: number, photo: Blob) => (
      calls.push(`part ${id} ${String(part)}`),
      putReceiptPart(id, part, photo)
    ),
    removeReceipt: (id: string) => (calls.push(`remove ${id}`), removeReceipt(id)),
    restoreReceipt: (id: string) => (calls.push(`restore ${id}`), restoreReceipt(id)),
    recordReceipt: (id: string, body: ReceiptRecordBody) => (
      calls.push(`record ${id}`),
      recordReceipt(id, body)
    ),
  },
}))

// The shelf is IndexedDB, which happy-dom has not got: the queue is held against one in memory,
// and the shelf itself is end-to-end's, in a real browser.
const photos = new Map<string, Blob>()
let refusePut = false
vi.mock('@/receipts/photoShelf', () => ({
  photoShelf: (owner: string): PhotoShelf => ({
    put: (id, part, photo) => {
      if (refusePut) return Promise.resolve(false)
      photos.set(`${owner}/${id}/${String(part)}`, photo)
      return Promise.resolve(true)
    },
    get: (id, part) => Promise.resolve(photos.get(`${owner}/${id}/${String(part)}`) ?? null),
    parts: (id) =>
      Promise.resolve(
        [...photos.entries()]
          .filter(([key]) => key.startsWith(`${owner}/${id}/`))
          .map(([, p]) => p),
      ),
    drop: (id) => {
      for (const key of [...photos.keys()])
        if (key.startsWith(`${owner}/${id}/`)) photos.delete(key)
      return Promise.resolve()
    },
    keepOnly: () => Promise.resolve(),
  }),
}))

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
// A Serbian receipt's link made up by the model's `madeUpSerbianLink` (MOL-232): a test of `src` may
// not import the package's testing export.
const SERBIAN_LINK =
  'https://suf.purs.gov.rs/v/?vl=A1RFU1RBQUFBVEVTVEJCQkIBAAAAAQAAANQ2SgAAAAAAAAABmBxSTwgAAABUc5Kx0O8OLUxriqnI5wYlRGOCocDf%2Fh08W3qZuNf2FTRTcpGwz%2B4NLEtqiajH5gUkQ2KBoL%2Fe%2FRw7WnmYt9b1FDNScZCvzu0MK0ppiKfG5QQjQmGAn77d%2FBs6WXiXttX0EzJRcI%2BuzewLKkloh6bF5AMiQWB%2Fnr3c%2Bxo5WHeWtdTzEjFQb46tzOsKKUhnhqXE4wIhQF9%2Bnbzb%2Bhk4V3aVtNPyETBPbo2sy%2BoJKEdmhaTD4gEgP159nLva%2BRg3VnWUs9LxEC9ObYyryukIJ0ZlhKPC4QAfPl18m7rZ%2BBc2VXSTstHwDy5NbIuqyegHJkVkg6LB4P8ePVx7mrnY9xY1VHOSsdDvDi1Ma4qpyOcGJURjgqHA3%2F4dPFt6mbjX9hU0U3KRsM%2FuDSxLaomox%2BYFJENigaC%2F3v0cO1p5mLfW9RQzUnGQr87tDCtKaYinxuUEI0JhgJ%2B%2B3fwbOll4l7bV9BMyUXCPrs3sCypJaIemxeQDIkFgf5693PsaOVh3lrXU8xIxUG%2BOrczrCilIZ4alxOMCIUBffp282%2FoZOFd2lbTT8hEwT26NrMvqCShHZoWkw%2BIBID9efZy72vkYN1Z1lLPS8RAvTm2Mq8rpCCdGZYSjwuEAHz5dfJu62fgXNlV0k7LR8A8uTWyLqsnoByZFZIOiweD%2FHj1ce5q52PcWNQ87U0RqxUqXGlv0IC2EMdY%3D'
const RECEIPT = 'cccccccc-0000-4000-8000-000000000001'
const SECOND = 'cccccccc-0000-4000-8000-000000000002'
const TRIP = 'dddddddd-0000-4000-8000-000000000001'
const MILK = 'aaaaaaaa-0000-4000-8000-000000000001'

function body(id = RECEIPT, parts = 2): ReceiptPhotoBody {
  return { id, parts, country: 'AM', language: 'ru', capturedAt: new Date('2026-10-03T15:00:00Z') }
}

function shots(n: number): Blob[] {
  return Array.from({ length: n }, (_, index) => new Blob([`photo ${String(index + 1)}`]))
}

function recordBody(tripId = TRIP): ReceiptRecordBody {
  return {
    tripId,
    place: { name: 'Ереван Сити', city: 'Гюмри' },
    purchasedOn: '2026-10-03',
    lines: [
      {
        position: 0,
        skip: false,
        item: { id: MILK },
        quantity: parseQuantity('1', 'piece'),
        amount: parseMoney('590', 'AMD'),
      },
      { position: 1, skip: true },
    ],
  }
}

function fresh(state: 'ready' | 'idle' = 'ready') {
  localStorage.setItem('molvia.actor', ME)
  setActivePinia(createPinia())
  useActorStore().state = state
  return useReceiptQueueStore()
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('receipt queue', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    calls.length = 0
    photos.clear()
    refusePut = false
    for (const mock of [sendReceipt, putReceiptPart, removeReceipt, restoreReceipt])
      mock.mockReset().mockResolvedValue(undefined)
    recordReceipt.mockReset().mockResolvedValue({ tripId: TRIP })
    vi.restoreAllMocks()
  })

  it('sends the receipt, then its parts in order, each with the photo from the shelf', async () => {
    const queue = fresh()
    expect(await queue.capture(body(), shots(2))).toBe(true)
    await queue.flush()
    expect(calls).toEqual([`create ${RECEIPT}`, `part ${RECEIPT} 1`, `part ${RECEIPT} 2`])
    expect(await putReceiptPart.mock.calls[1]?.[2].text()).toBe('photo 2')
    expect(queue.pending).toEqual([])
    // The photos stay: «не разобран» shows them from this phone (Т-4).
    expect(photos.size).toBe(2)
  })

  it('sends a receipt by its link as one write, no photo, and holds it delivered as it lands (MOL-232)', async () => {
    const queue = fresh()
    const link: ReceiptLinkBody = {
      id: RECEIPT,
      link: SERBIAN_LINK,
      country: 'RS',
      language: 'ru',
      capturedAt: new Date('2026-10-03T15:00:00Z'),
    }
    expect(queue.sendLink(link)).toBe(true)
    await queue.flush()
    expect(calls).toEqual([`create ${RECEIPT}`])
    expect(sendReceipt).toHaveBeenCalledWith(link)
    expect(photos.size).toBe(0)
    expect(RECEIPT in queue.delivered).toBe(true)
    // kept across a restart as written, its link with it
    expect(fresh().pending).toEqual([])
  })

  it('keeps a receipt by its link across a restart while it waits for a connection (MOL-232)', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const queue = fresh()
    const link = SERBIAN_LINK
    queue.sendLink({ id: RECEIPT, link, country: 'RS', language: 'ru', capturedAt: new Date() })
    await queue.flush()
    expect(calls).toEqual([])
    const again = fresh()
    expect(again.pending).toMatchObject([{ kind: 'create', body: { id: RECEIPT, link } }])
  })

  it('remembers a receipt delivered whole, kept on the phone, until the list says where it is (Б1)', async () => {
    const queue = fresh()
    await queue.capture(body(), shots(2))
    putReceiptPart.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'Load failed', false))
    await queue.flush()
    // One part landed, one held: not whole yet.
    expect(RECEIPT in queue.delivered).toBe(false)
    await queue.flush()
    expect(RECEIPT in queue.delivered).toBe(true)
    // A restart still knows: the list read after it may be a connection away.
    expect(RECEIPT in fresh().delivered).toBe(true)
    useReceiptQueueStore().settleDelivered(new Set([RECEIPT]))
    expect(RECEIPT in fresh().delivered).toBe(false)
  })

  it('queues nothing for a receipt whose photos are not the parts it announces', async () => {
    const queue = fresh()
    expect(await queue.capture(body(RECEIPT, 2), shots(1))).toBe(false)
    expect(queue.pending).toEqual([])
  })

  it('queues nothing when the phone had nowhere to keep a photo', async () => {
    refusePut = true
    const queue = fresh()
    expect(await queue.capture(body(), shots(2))).toBe(false)
    expect(queue.pending).toEqual([])
    expect(calls).toEqual([])
  })

  it('a receipt taken with no signal waits on the shelf and goes once the connection is back', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const queue = fresh()
    expect(await queue.capture(body(RECEIPT, 1), shots(1))).toBe(true)
    await queue.flush()
    expect(calls).toEqual([])
    expect(queue.pending).toHaveLength(2)

    online.mockReturnValue(true)
    // The app opened again later: the queue is storage, not memory.
    const again = fresh()
    expect(again.pending).toHaveLength(2)
    await again.flush()
    expect(calls).toEqual([`create ${RECEIPT}`, `part ${RECEIPT} 1`])
  })

  it.each([
    ['a connection that dropped', new ApiError(ERROR.INTERNAL, 'x', false)],
    ['a portal page', new ApiError(ISSUE.RESPONSE_INVALID, 'x', false)],
    ['a code the API did not say itself', new ApiError(ERROR.NOT_FOUND, 'x', false)],
    ['an identity the server forgot', new ApiError(ERROR.NO_ACTOR, 'x')],
    ['a server that broke', new ApiError(ERROR.INTERNAL, 'x')],
  ])('%s holds the queue rather than dropping the receipt', async (_, error) => {
    putReceiptPart.mockRejectedValueOnce(error)
    const queue = fresh()
    await queue.capture(body(), shots(2))
    await queue.capture(body(SECOND, 1), shots(1))
    await settled()
    expect(calls).toEqual([`create ${RECEIPT}`, `part ${RECEIPT} 1`])
    expect(queue.pending).toHaveLength(4)
    expect(queue.rejected).toEqual([])
  })

  it.each([
    ['not a photo', ERROR.RECEIPT_NOT_PHOTO],
    ['too large', ERROR.RECEIPT_TOO_LARGE],
  ])(
    'a part refused as %s is «не принят»: never sent again, its later parts go with it',
    async (_, code) => {
      putReceiptPart.mockRejectedValueOnce(new ApiError(code, 'x'))
      const queue = fresh()
      await queue.capture(body(RECEIPT, 3), shots(3))
      await queue.capture(body(SECOND, 1), shots(1))
      await queue.flush()
      expect(calls).toEqual([
        `create ${RECEIPT}`,
        `part ${RECEIPT} 1`,
        `create ${SECOND}`,
        `part ${SECOND} 1`,
      ])
      expect(queue.pending).toEqual([])
      expect(queue.rejected).toMatchObject([
        { code, write: { kind: 'part', id: RECEIPT, part: 1 } },
      ])
    },
  )

  it('a part whose photo the shelf lost is «не принят», not a request without a body', async () => {
    const queue = fresh('idle')
    await queue.capture(body(RECEIPT, 1), shots(1))
    photos.clear()
    useActorStore().state = 'ready'
    await queue.flush()
    expect(calls).toEqual([`create ${RECEIPT}`])
    expect(queue.rejected).toMatchObject([{ code: ERROR.NOT_FOUND, write: { kind: 'part' } }])
  })

  it('a part of a receipt removed on another phone is done, and so are the rest', async () => {
    putReceiptPart.mockRejectedValue(new ApiError(ERROR.NOT_FOUND, 'x'))
    const queue = fresh()
    await queue.capture(body(), shots(2))
    await queue.flush()
    expect(queue.pending).toEqual([])
    expect(queue.rejected).toEqual([])
  })

  it('«Убрать» on a refused receipt removes it from the server and its photos from the phone', async () => {
    putReceiptPart.mockRejectedValueOnce(new ApiError(ERROR.RECEIPT_NOT_PHOTO, 'x'))
    const queue = fresh()
    await queue.capture(body(RECEIPT, 1), shots(1))
    await queue.flush()
    const [refused] = queue.rejected
    if (!refused) throw new Error('no refusal')
    queue.dismiss(refused)
    await queue.flush()
    await settled()
    expect(calls.at(-1)).toBe(`remove ${RECEIPT}`)
    expect(queue.rejected).toEqual([])
    expect(photos.size).toBe(0)
  })

  describe('«Удалить чек» and «Вернуть»', () => {
    it('a receipt nobody began to send is taken out of the queue, and put back whole', async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      const queue = fresh()
      await queue.capture(body(), shots(2))
      const undo = queue.remove(RECEIPT)
      expect(queue.pending).toEqual([])
      expect(queue.lastRemoved?.undo.id).toBe(RECEIPT)
      queue.restore(undo)
      expect(queue.pending.map((write) => write.kind)).toEqual(['create', 'part', 'part'])
      expect(queue.lastRemoved).toBeNull()
    })

    it('its photos go only when the strip goes', async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      const queue = fresh()
      await queue.capture(body(), shots(2))
      queue.remove(RECEIPT)
      expect(photos.size).toBe(2)
      queue.forgetRemoved()
      await settled()
      expect(photos.size).toBe(0)
    })

    it('one the server may have goes to it as a removal, and «Вернуть» as a restore', async () => {
      const queue = fresh()
      await queue.capture(body(RECEIPT, 1), shots(1))
      await queue.flush()
      const undo = queue.remove(RECEIPT)
      await queue.flush()
      queue.restore(undo)
      await queue.flush()
      expect(calls.slice(-2)).toEqual([`remove ${RECEIPT}`, `restore ${RECEIPT}`])
    })

    it('«Вернуть» before the removal left takes the removal back — nothing is sent', async () => {
      const queue = fresh()
      await queue.capture(body(RECEIPT, 1), shots(1))
      await queue.flush()
      calls.length = 0
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      const undo = queue.remove(RECEIPT)
      queue.restore(undo)
      expect(queue.pending).toEqual([])
      expect(calls).toEqual([])
    })

    it('parts still waiting once the announcement left go out with the removal, and come back with «Вернуть» (А3)', async () => {
      putReceiptPart.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'x', false))
      const queue = fresh()
      await queue.capture(body(RECEIPT, 2), shots(2))
      await settled()
      // The announcement landed; part 1 was tried, its answer lost.
      calls.length = 0
      const undo = queue.remove(RECEIPT)
      expect(queue.pending.map((write) => write.kind)).toEqual(['part', 'remove'])
      expect(undo.writes?.map((write) => write.kind)).toEqual(['part'])
      queue.restore(undo)
      // The removal still waiting is taken back, and the part put back after the one that was tried.
      expect(queue.pending.map((write) => write.kind)).toEqual(['part', 'part'])
    })

    it('a removal of a recorded receipt (409) is done: no «не принят» for a receipt in «Записаны» (А1)', async () => {
      removeReceipt.mockRejectedValueOnce(new ApiError(ERROR.CONFLICT, 'x'))
      const queue = fresh()
      queue.remove(RECEIPT)
      await queue.flush()
      expect(queue.rejected).toEqual([])
    })

    it('a refusal keeps the moment it came: the row is not dated by when it is drawn', async () => {
      putReceiptPart.mockRejectedValueOnce(new ApiError(ERROR.RECEIPT_NOT_PHOTO, 'x'))
      const queue = fresh()
      await queue.capture(body(RECEIPT, 1), shots(1))
      await queue.flush()
      const at = queue.rejected[0]?.at ?? 0
      expect(at).toBeGreaterThan(0)
      expect(fresh().rejected[0]?.at).toBe(at)
    })

    it('a removal of a receipt the server does not have is done', async () => {
      removeReceipt.mockRejectedValueOnce(new ApiError(ERROR.NOT_FOUND, 'x'))
      const queue = fresh()
      await queue.capture(body(RECEIPT, 1), shots(1))
      await queue.flush()
      queue.remove(RECEIPT)
      await queue.flush()
      expect(queue.rejected).toEqual([])
    })
  })

  describe('«Записать»', () => {
    it('records under the trip the phone named, and lets the photos go', async () => {
      const queue = fresh()
      await queue.capture(body(RECEIPT, 1), shots(1))
      await queue.flush()
      queue.record(RECEIPT, recordBody())
      await queue.flush()
      expect(recordReceipt.mock.calls[0]?.[1].tripId).toBe(TRIP)
      expect(queue.recorded).toEqual([{ receiptId: RECEIPT, tripId: TRIP, count: 1 }])
      expect(photos.size).toBe(0)
    })

    it('a second tap while the first waits is one record', () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      const queue = fresh()
      queue.record(RECEIPT, recordBody())
      queue.record(RECEIPT, recordBody('dddddddd-0000-4000-8000-000000000002'))
      expect(queue.pending).toHaveLength(1)
    })

    it('a refusal is set aside, and the next «Записать» takes its place', async () => {
      recordReceipt.mockRejectedValueOnce(new ApiError(ERROR.RECEIPT_RECORDED_BEFORE, 'x'))
      const queue = fresh()
      queue.record(RECEIPT, recordBody())
      await queue.flush()
      expect(queue.rejected).toMatchObject([
        { code: ERROR.RECEIPT_RECORDED_BEFORE, write: { kind: 'record', id: RECEIPT } },
      ])
      queue.record(RECEIPT, recordBody('dddddddd-0000-4000-8000-000000000002'))
      expect(queue.rejected).toEqual([])
    })

    it('a lost answer holds it, and the repeat goes under the same trip', async () => {
      recordReceipt.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'x', false))
      const queue = fresh()
      queue.record(RECEIPT, recordBody())
      await settled()
      expect(queue.pending).toHaveLength(1)
      const again = fresh()
      await again.flush()
      expect(recordReceipt.mock.calls.map((call) => call[1].tripId)).toEqual([TRIP, TRIP])
    })
  })

  describe('«Отменить запись» (MOL-169, В-5)', () => {
    const OTHER_TRIP = 'dddddddd-0000-4000-8000-000000000002'

    it('a record that never left is taken out, and nothing is sent', async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      const queue = fresh()
      queue.record(RECEIPT, recordBody())
      expect(queue.cancelRecord(RECEIPT)).toBe(true)
      expect(queue.pending).toEqual([])
      expect(localStorage.getItem(`molvia.receipt-queue.${ME}`)).toBe('[]')
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
      await queue.flush()
      expect(recordReceipt).not.toHaveBeenCalled()
    })

    it('a record the server answered 5xx is taken out once checked, and the receipts behind it go on', async () => {
      recordReceipt.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'x'))
      const queue = fresh()
      queue.record(RECEIPT, recordBody())
      await queue.flush()
      await queue.capture(body(SECOND, 1), shots(1))
      await queue.flush()
      expect(queue.pending).toHaveLength(3)
      expect(calls).not.toContain(`create ${SECOND}`)
      expect(queue.recordBegun(RECEIPT)).toBe(true)

      // Begun, it may have landed: unchecked it stays (adversarial А1); the review checks first.
      expect(queue.cancelRecord(RECEIPT)).toBe(false)
      await settled()
      expect(queue.pending).toHaveLength(3)
      expect(await queue.cancelChecked(RECEIPT, () => Promise.resolve(true))).toBe(true)
      await queue.flush()
      expect(queue.pending).toEqual([])
      expect(calls.filter((call) => !call.startsWith('record'))).toEqual([
        `create ${SECOND}`,
        `part ${SECOND} 1`,
      ])
    })

    it('a record sent again after the cancel names another trip; a conflict is set aside, not held', async () => {
      recordReceipt
        .mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'x', false))
        .mockRejectedValueOnce(new ApiError(ERROR.CONFLICT, 'x'))
      const queue = fresh()
      queue.record(RECEIPT, recordBody())
      await settled()
      await queue.cancelChecked(RECEIPT, () => Promise.resolve(true))
      await settled()
      queue.record(RECEIPT, recordBody(OTHER_TRIP))
      await queue.flush()
      expect(recordReceipt.mock.calls.map((call) => call[1].tripId)).toEqual([TRIP, OTHER_TRIP])
      expect(queue.pending).toEqual([])
      expect(queue.rejected).toMatchObject([
        { code: ERROR.CONFLICT, write: { kind: 'record', id: RECEIPT } },
      ])
    })

    it('the record a send carries right now stays, and lands', async () => {
      let land: (answer: { tripId: string }) => void = () => undefined
      recordReceipt.mockImplementationOnce(() => new Promise((resolve) => (land = resolve)))
      const queue = fresh()
      queue.record(RECEIPT, recordBody())
      await settled()
      expect(queue.carrying).toBe(RECEIPT)
      expect(queue.cancelRecord(RECEIPT)).toBe(false)
      expect(queue.pending).toHaveLength(1)
      land({ tripId: TRIP })
      await queue.flush()
      expect(queue.carrying).toBeNull()
      expect(queue.recorded).toEqual([{ receiptId: RECEIPT, tripId: TRIP, count: 1 }])
    })

    it('takes only this receipt’s record, never its removal or another receipt’s', () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      const queue = fresh()
      queue.record(RECEIPT, recordBody())
      queue.record(SECOND, recordBody(OTHER_TRIP))
      queue.remove(SECOND)
      expect(queue.cancelRecord(SECOND)).toBe(true)
      expect(queue.cancelRecord(SECOND)).toBe(false)
      expect(queue.pending).toEqual([
        { kind: 'record', id: RECEIPT, body: recordBody() },
        { kind: 'remove', id: SECOND },
      ])
    })

    it('a send another window began is begun here too, and stays without the check (adversarial А4)', async () => {
      let land: (answer: { tripId: string }) => void = () => undefined
      recordReceipt.mockImplementationOnce(() => new Promise((resolve) => (land = resolve)))
      const first = fresh()
      first.record(RECEIPT, recordBody())
      await settled()
      expect(first.carrying).toBe(RECEIPT)
      const second = fresh('idle')
      expect(second.carrying).toBeNull()
      expect(second.recordBegun(RECEIPT)).toBe(true)
      expect(second.cancelRecord(RECEIPT)).toBe(false)
      expect(second.pending).toHaveLength(1)
      land({ tripId: TRIP })
      await first.flush()
      expect(first.recorded).toEqual([{ receiptId: RECEIPT, tripId: TRIP, count: 1 }])
    })

    it('a receipt the server says is recorded lets its waiting record and its refusal go (review 1, А2)', async () => {
      recordReceipt.mockRejectedValueOnce(new ApiError(ERROR.CONFLICT, 'x'))
      const queue = fresh()
      queue.record(RECEIPT, recordBody())
      await queue.flush()
      expect(queue.rejected).toHaveLength(1)
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      queue.record(SECOND, recordBody(OTHER_TRIP))
      queue.remove(SECOND)
      queue.settleRecorded(new Set([RECEIPT, SECOND]))
      expect(queue.rejected).toEqual([])
      expect(queue.pending).toEqual([{ kind: 'remove', id: SECOND }])
      // Kept so after a reload: storage is the queue.
      expect(fresh('idle').rejected).toEqual([])
    })

    it('a checked cancel asks the server only once another window’s send has ended (round 2, Б1)', async () => {
      // happy-dom has no `navigator.locks`: one that queues requests of a name, as a browser does
      const held = new Map<string, Promise<unknown>>()
      const request = (name: string, work: () => Promise<unknown>) => {
        const run = (held.get(name) ?? Promise.resolve()).then(work, work)
        held.set(
          name,
          run.catch(() => undefined),
        )
        return run
      }
      Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true })
      try {
        let land: (answer: { tripId: string }) => void = () => undefined
        recordReceipt.mockImplementationOnce(() => new Promise((resolve) => (land = resolve)))
        const first = fresh()
        first.record(RECEIPT, recordBody())
        await settled()
        expect(first.carrying).toBe(RECEIPT)

        const second = fresh('idle')
        const asked: string[] = []
        const cancel = second.cancelChecked(RECEIPT, () => {
          asked.push(first.carrying ?? 'nothing on its way')
          return Promise.resolve(true)
        })
        await settled()
        expect(asked).toEqual([])
        land({ tripId: TRIP })
        await cancel
        // Asked after the send ended: its record was out of the queue, nothing to take.
        expect(asked).toEqual(['nothing on its way'])
        expect(first.recorded).toEqual([{ receiptId: RECEIPT, tripId: TRIP, count: 1 }])
      } finally {
        Reflect.deleteProperty(navigator, 'locks')
      }
    })

    it('another window sees the cancel through storage', () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      const first = fresh()
      first.record(RECEIPT, recordBody())
      const second = fresh()
      expect(second.pending).toHaveLength(1)
      second.cancelRecord(RECEIPT)
      window.dispatchEvent(new StorageEvent('storage', { key: `molvia.receipt-queue.${ME}` }))
      expect(first.pending).toEqual([])
    })
  })

  it('a broken entry is dropped alone', () => {
    localStorage.setItem(
      `molvia.receipt-queue.${ME}`,
      JSON.stringify([
        { key: 'a', write: { kind: 'part', id: RECEIPT, part: 9 } },
        { key: 'b', write: { kind: 'remove', id: RECEIPT } },
      ]),
    )
    expect(fresh('idle').pending).toEqual([{ kind: 'remove', id: RECEIPT }])
  })
})
