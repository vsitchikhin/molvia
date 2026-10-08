import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  RECEIPT_CODES_HEADER,
  RECEIPT_LINK_WAIT_HOURS,
  receiptDetailCodec,
  toSearchKey,
  receiptRecordedCodec,
  receiptSummaryCodec,
  serbianReceiptLink,
} from '@molvia/model'
import { madeUpJournal, madeUpSerbianLink } from '@molvia/model/testing/serbian-receipt'
import type { FastifyInstance } from 'fastify'
import { createItemRepository } from '@/db/items-repository'
import { createReceiptRepository } from '@/db/receipts-repository'
import {
  itemBarcodes,
  receiptDays,
  receiptLines,
  receiptLinks,
  receipts,
  storeMemory,
  taxReceiptDays,
  trips,
} from '@/db/schema'
import { NO_EMBEDDER } from '@/embeddings/embedder'
import type { Purs, PursAnswer, PursSpecification } from '@/purs/client'
import { bindReceiptLines } from '@/usecases/bind-receipt-lines'
import { readTaxReceipts } from '@/usecases/read-tax-receipts'
import { claimReceiptNotices } from '@/usecases/tell-receipts'
import type { TaxReport } from '@/usecases/read-tax-receipts'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, signIn } from './fixtures'

// MOL-232 — a Serbian receipt by the link of its QR code: taken at the door, asked of the tax office
// in a queue of its own, read from its journal, reviewed and recorded as a photo's receipt is.

const { db, close } = connectDrizzle()
const repository = createReceiptRepository(db)
let app: FastifyInstance

beforeAll(async () => {
  // no reader, no tax office: receipts wait, and each test asks a fake itself
  app = buildServer({ db, receiptReader: null, purs: null })
  await app.ready()
})
beforeEach(async () => {
  await clearAll(db)
})
afterAll(async () => {
  await app.close()
  await clearAll(db)
  await close()
})

const AT = new Date('2025-07-18T06:56:53.834Z') // 08:56 in Belgrade, summer time
const TIN = '100000009'
const LINES = [
  { name: 'SECER KRISTAL 1KG SUNOKO KOM (Е)', price: '94,99', quantity: '2', sum: '189,98' },
  { name: 'BANANA KG (Е)', price: '199,99', quantity: '1,482', sum: '296,39' },
]
const JOURNAL = madeUpJournal(LINES, '486,37')

interface Owner {
  readonly id: string
  readonly cookie: string
}

async function serb(): Promise<Owner> {
  const id = await insertActor(db, { country: 'RS', city: 'Белград', spendCurrency: 'RSD' })
  return { id, cookie: await signIn(db, id) }
}

let counter = 0
function link(over: Partial<Parameters<typeof madeUpSerbianLink>[0]> = {}): string {
  return madeUpSerbianLink({ totalHundredths: 48_637, at: AT, counter: ++counter, ...over })
}

const body = (url: string, over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  link: url,
  country: 'RS',
  language: 'ru',
  capturedAt: '2025-07-18T07:10:00.000Z',
  ...over,
})

function send(me: Owner, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/receipts', headers: { cookie: me.cookie }, payload })
}

function get(me: Owner, url: string) {
  return app.inject({ method: 'GET', url, headers: { cookie: me.cookie } })
}

async function taken(me: Owner, url = link()): Promise<string> {
  const payload = body(url)
  expect((await send(me, payload)).statusCode).toBe(201)
  return payload.id
}

const found = (over: Partial<Extract<PursAnswer, { kind: 'found' }>> = {}): PursAnswer => ({
  kind: 'found',
  tin: TIN,
  locationName: '1113343-RODA MEGAMARKET 463',
  city: 'БЕОГРАД (ЗЕМУН)',
  administrativeUnit: 'Београд-Земун',
  // the number of the receipt asked about, filled in by `office` from its link unless a test names one
  number: '',
  journal: JOURNAL,
  ...over,
})

/** The tax office; its specification is not asked unless a test hands it answers (MOL-234). */
function office(...answers: PursAnswer[]): Purs & {
  asked: string[]
  specs: PursSpecification[]
  specified: ReturnType<typeof vi.fn<Purs['specification']>>
} {
  const asked: string[] = []
  const specs: PursSpecification[] = []
  const specification = vi.fn<Purs['specification']>(() =>
    Promise.resolve(specs.shift() ?? { kind: 'skipped' }),
  )
  return {
    asked,
    specs,
    specification,
    specified: specification,
    receipt: vi.fn((url: string) => {
      asked.push(url)
      const answer = answers.shift() ?? found()
      const signed = serbianReceiptLink(url)
      return Promise.resolve(
        answer.kind === 'found' && answer.number === '' && signed.ok
          ? { ...answer, number: signed.number }
          : answer,
      )
    }),
  }
}

const reports: TaxReport[] = []

function round(purs: Purs): Promise<number> {
  return readTaxReceipts({
    receipts: repository,
    purs,
    report: (event) => reports.push(event),
    bind: (claimed, lines, codes) =>
      bindReceiptLines(
        { items: createItemRepository(db), embedder: NO_EMBEDDER },
        claimed.actorId,
        claimed.country,
        claimed.language,
        lines,
        codes,
      ),
  })
}

/** The receipt's row with its link beside it — kept in a table of its own (adversarial А4). */
const row = async (id: string) => {
  const [found] = await db.select().from(receipts).where(eq(receipts.id, id))
  if (found === undefined) return undefined
  const [held] = await db.select().from(receiptLinks).where(eq(receiptLinks.receiptId, id))
  return { ...found, link: held?.link ?? null }
}
const days = () => db.select().from(receiptDays)
/** The one day of `tax_receipt_days` a test wrote, its counts that are not zero (MOL-234). */
async function taxDay(): Promise<Record<string, number>> {
  const rows = await db.select().from(taxReceiptDays)
  expect(rows).toHaveLength(1)
  return Object.fromEntries(
    Object.entries(rows[0] ?? {}).filter(([key, n]) => key !== 'day' && n !== 0),
  ) as Record<string, number>
}
const due = (id: string) =>
  db
    .update(receipts)
    .set({ nextAttemptAt: sql`clock_timestamp() - interval '1 second'` })
    .where(eq(receipts.id, id))

describe('«Отправить чек» by its link', () => {
  it('takes a link straight into the tax office’s queue, its head read off the link itself', async () => {
    const me = await serb()
    const url = link({ requestedBy: 'GL7XT63N', signedBy: 'GL7XT63N', counter: 12_218 })
    const payload = body(url)
    const response = await send(me, payload)
    expect(response.statusCode).toBe(201)
    expect(receiptSummaryCodec.parse(response.json())).toMatchObject({
      status: 'queued',
      failure: null,
      parts: 0,
      received: 0,
      country: 'RS',
      header: {
        tin: null,
        date: '2025-07-18',
        time: '08:56',
        receiptNo: 'GL7XT63N-GL7XT63N-12218',
        shop: null,
      },
      total: { minor: 48_637n, currency: 'RSD' },
    })
    expect(await row(payload.id)).toMatchObject({
      source: 'tax',
      link: url,
      currency: 'RSD',
      attempts: 0,
    })
    expect((await row(payload.id))?.nextAttemptAt).not.toBeNull()
  })

  it('is the same receipt sent again, and a conflict under its id with another link or a photo', async () => {
    const me = await serb()
    const payload = body(link())
    expect((await send(me, payload)).statusCode).toBe(201)
    expect((await send(me, payload)).statusCode).toBe(200)
    expect((await send(me, { ...payload, link: link() })).statusCode).toBe(409)
    const photo = {
      id: payload.id,
      parts: 1,
      country: 'AM',
      language: payload.language,
      capturedAt: payload.capturedAt,
    }
    expect((await send(me, photo)).statusCode).toBe(409)
  })

  it('is the same receipt sent again once read, its link gone', async () => {
    const me = await serb()
    const payload = body(link())
    await send(me, payload)
    await round(office(found()))
    expect((await row(payload.id))?.link).toBeNull()
    expect((await send(me, payload)).statusCode).toBe(200)
  })

  it('refuses at the door a link that is no receipt to record, and a Serbian photo', async () => {
    const me = await serb()
    const damaged = await send(me, body(link().slice(0, -12)))
    expect(damaged.statusCode).toBe(400)
    expect(z.object({ code: z.string() }).parse(damaged.json()).code).toBe(
      'error.receipt_link_invalid',
    )
    expect((await send(me, body(link({ transactionType: 1 })))).statusCode).toBe(400)
    expect((await send(me, body(link({ invoiceType: 2 })))).statusCode).toBe(400)
    const photo = { id: randomUUID(), parts: 1, country: 'RS', language: 'ru', capturedAt: AT }
    expect((await send(me, photo)).statusCode).toBe(400)
    expect(await db.select().from(receipts)).toEqual([])
  })

  it('is never taken by the reader’s queue', async () => {
    const me = await serb()
    await taken(me)
    expect(await repository.claimNext()).toBeNull()
  })
})

describe('the tax office’s queue', () => {
  it('reads the journal into lines, the seller, the premises and the town, and lets the link go', async () => {
    const me = await serb()
    const id = await taken(
      me,
      link({ requestedBy: 'GL7XT63N', signedBy: 'GL7XT63N', counter: 12_218 }),
    )
    const purs = office(found())

    expect(await round(purs)).toBe(1)

    expect(purs.asked).toHaveLength(1)
    expect(await row(id)).toMatchObject({
      status: 'parsed',
      failure: null,
      link: null,
      nextAttemptAt: null,
      tin: TIN,
      shopUnit: '1113343',
      shop: 'RODA MEGAMARKET 463',
      city: 'Белград',
      // the link's own number, signed — the tax office prints the same
      receiptNo: 'GL7XT63N-GL7XT63N-12218',
      printedOn: '2025-07-18',
      printedTime: '08:56',
      totalMinor: 48_637n,
      balanced: true,
      attempts: 1,
      readerVersion: 'purs',
    })
    const lines = await db.select().from(receiptLines).where(eq(receiptLines.receiptId, id))
    expect(
      lines
        .sort((a, b) => a.position - b.position)
        .map(({ printed, qtyMilli, qtyUnit, priceMinor, sumMinor, settled, match }) => ({
          printed,
          qtyMilli,
          qtyUnit,
          priceMinor,
          sumMinor,
          settled,
          match,
        })),
    ).toEqual([
      {
        printed: 'SECER KRISTAL 1KG SUNOKO KOM',
        qtyMilli: 2_000n,
        qtyUnit: 'piece',
        priceMinor: 9_499n,
        sumMinor: 18_998n,
        settled: true,
        match: 'new',
      },
      {
        printed: 'BANANA KG',
        qtyMilli: 1_482n,
        qtyUnit: 'kg',
        priceMinor: 19_999n,
        sumMinor: 29_639n,
        settled: true,
        match: 'new',
      },
    ])
    const detail = receiptDetailCodec.parse((await get(me, `/receipts/${id}`)).json())
    expect(detail.receipt.header).toMatchObject({ tin: TIN, shop: 'RODA MEGAMARKET 463' })
  })

  it('counts nothing in receipt_days, reading or failing: its own table counts it (MOL-234)', async () => {
    const me = await serb()
    await taken(me)
    await taken(me)
    await taken(me)
    await round(office(found(), { kind: 'refused' }, found({ journal: 'no list' })))
    expect(await days()).toEqual([])
    // a journal with no list is the tax office's answer, never a failure of ours (adversarial А7)
    expect(await taxDay()).toEqual({
      sentUnnamed: 3,
      read: 1,
      invalid: 1,
      empty: 1,
      specsSkipped: 1,
    })
  })

  it('asks again a receipt the tax office does not show yet, the pause growing, then reads it', async () => {
    const me = await serb()
    const id = await taken(me)
    const purs = office({ kind: 'not_yet' }, { kind: 'not_yet' }, found())

    await round(purs)
    const first = await row(id)
    expect(first).toMatchObject({
      status: 'queued',
      attempts: 1,
      link: expect.any(String) as unknown,
    })
    const [{ pause } = { pause: 0 }] = await db.execute<{ pause: number }>(
      sql`select extract(epoch from next_attempt_at - clock_timestamp())::int as pause from receipts where id = ${id}`,
    )
    expect(pause).toBeGreaterThan(50)
    expect(pause).toBeLessThanOrEqual(60)
    // not due yet: the round asks nothing
    expect(await round(purs)).toBe(0)

    await due(id)
    await round(purs)
    const [{ second } = { second: 0 }] = await db.execute<{ second: number }>(
      sql`select extract(epoch from next_attempt_at - clock_timestamp())::int as second from receipts where id = ${id}`,
    )
    expect(second).toBeGreaterThan(110)
    expect(second).toBeLessThanOrEqual(120)

    await due(id)
    await round(purs)
    expect(await row(id)).toMatchObject({ status: 'parsed', attempts: 3, link: null })
    expect(reports.filter((report) => report.kind === 'not_yet')).not.toHaveLength(0)
  })

  it(`fails as missing once ${String(RECEIPT_LINK_WAIT_HOURS)} hours passed since it arrived, and only then`, async () => {
    const me = await serb()
    const late = await taken(me)
    const almost = await taken(me)
    await db
      .update(receipts)
      .set({
        createdAt: sql`clock_timestamp() - make_interval(hours => ${RECEIPT_LINK_WAIT_HOURS}, secs => 1)`,
      })
      .where(eq(receipts.id, late))
    await db
      .update(receipts)
      .set({
        createdAt: sql`clock_timestamp() - make_interval(hours => ${RECEIPT_LINK_WAIT_HOURS - 1})`,
      })
      .where(eq(receipts.id, almost))

    await round(office({ kind: 'not_yet' }, { kind: 'not_yet' }))

    expect(await row(late)).toMatchObject({
      status: 'failed',
      failure: 'missing',
      link: null,
      nextAttemptAt: null,
    })
    expect((await row(late))?.readAt).not.toBeNull()
    expect(await row(almost)).toMatchObject({ status: 'queued', failure: null })
    expect(await days()).toEqual([])
    // given up is counted once, on the day it was; the receipt still asked is nothing yet
    expect(await taxDay()).toMatchObject({ missing: 1 })
    expect(await taxDay()).not.toHaveProperty('read')
  })

  it('fails as invalid what the tax office refuses, and as unreadable a journal with no list', async () => {
    const me = await serb()
    const refused = await taken(me)
    const empty = await taken(me)
    await round(office({ kind: 'refused' }, found({ journal: '==== ФИСКАЛНИ РАЧУН ====' })))
    expect(await row(refused)).toMatchObject({ status: 'failed', failure: 'invalid', link: null })
    expect(await row(empty)).toMatchObject({ status: 'failed', failure: 'unreadable', link: null })
  })

  it('keeps what the link said when the tax office refuses it, and the same body again is the same answer (review 2, А1)', async () => {
    const me = await serb()
    const refused = body(link())
    const empty = body(link())
    expect((await send(me, refused)).statusCode).toBe(201)
    expect((await send(me, empty)).statusCode).toBe(201)
    await round(office({ kind: 'refused' }, found({ journal: '==== ФИСКАЛНИ РАЧУН ====' })))
    for (const payload of [refused, empty]) {
      expect(await row(payload.id)).toMatchObject({
        status: 'failed',
        printedOn: '2025-07-18',
        printedTime: '08:56',
        totalMinor: 48_637n,
        link: null,
      })
      // the queue's own repeat of a send whose answer was lost: the receipt itself, never a 409
      const again = await send(me, payload)
      expect(again.statusCode).toBe(200)
      expect(receiptSummaryCodec.parse(again.json()).header?.date).toBe('2025-07-18')
    }
  })

  it('refuses an answer about another receipt than the one the link signs (review 8)', async () => {
    const me = await serb()
    const id = await taken(me)
    await round(office(found({ number: 'OTHERAAA-OTHERBBB-7' })))
    expect(await row(id)).toMatchObject({ status: 'failed', failure: 'invalid', link: null })
  })

  it('keeps the link apart, where the nightly copy does not reach (А4), and fails a receipt restored without it', async () => {
    const script = readFileSync(new URL('../../deploy/backup/backup.sh', import.meta.url), 'utf8')
    expect(script).toContain('--exclude-table-data=receipt_links')
    const columns = await db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_name = 'receipts'`,
    )
    expect(columns.map((one) => one.column_name)).not.toContain('link')

    const me = await serb()
    const id = await taken(me)
    // what a restore brings back: the receipt, and no link to ask with
    await db.delete(receiptLinks).where(eq(receiptLinks.receiptId, id))
    const purs = office(found())
    expect(await round(purs)).toBe(0)
    expect(purs.asked).toEqual([])
    expect(await row(id)).toMatchObject({ status: 'failed', failure: 'unreadable' })
  })

  it('tells the bot of a failed receipt by its link in the tax office’s word, never a photo’s (Р2-1, Р2-2)', async () => {
    const me = await serb()
    const refused = await taken(me)
    const missing = await taken(me)
    const lost = await taken(me)
    await db
      .update(receipts)
      .set({
        createdAt: sql`clock_timestamp() - make_interval(hours => ${RECEIPT_LINK_WAIT_HOURS}, secs => 1)`,
      })
      .where(eq(receipts.id, missing))
    // what a restore brings back: the receipt with no link to ask with
    await db.delete(receiptLinks).where(eq(receiptLinks.receiptId, lost))
    await round(office({ kind: 'refused' }, { kind: 'not_yet' }))
    await db.update(receipts).set({ readAt: sql`clock_timestamp() - interval '31 seconds'` })
    const { notices } = await claimReceiptNotices(repository, new Date(), () => {
      throw new Error('a notice the contract refused')
    })
    const told = new Map(notices.map((notice) => [notice.receiptId, notice]))
    expect(told.get(refused)).toMatchObject({ outcome: 'failed', taxOffice: 'invalid' })
    expect(told.get(missing)).toMatchObject({ outcome: 'failed', taxOffice: 'missing' })
    // never asked: no cause of the tax office's asserted
    expect(told.get(lost)).toMatchObject({ outcome: 'failed', taxOffice: 'unread' })
  })

  it('stops the round over the limit and leaves the receipt as it was, its ask not counted', async () => {
    const me = await serb()
    const id = await taken(me)
    const purs = office({ kind: 'skipped' })
    expect(await round(purs)).toBe(0)
    expect(await row(id)).toMatchObject({ status: 'queued', attempts: 0 })
  })

  it('asks people in turn: one person’s second receipt waits behind another’s first', async () => {
    const anna = await serb()
    const boris = await serb()
    await taken(anna)
    await round(office(found()))
    await taken(anna)
    await taken(boris)
    const purs = office({ kind: 'skipped' })
    // the first ask of the round is Boris's: Anna was asked about within the hour
    await round(purs)
    const [askedAbout] = purs.asked
    const [borisReceipt] = await db.select().from(receipts).where(eq(receipts.actorId, boris.id))
    expect(askedAbout).toBe((await row(borisReceipt?.id ?? ''))?.link)
  })

  it('begins again an ask the last process did not finish, the ask not counted', async () => {
    const me = await serb()
    const id = await taken(me)
    const claimed = await repository.claimLink()
    expect(claimed?.id).toBe(id)
    expect(await row(id)).toMatchObject({ status: 'reading', attempts: 1 })
    await round(office(found()))
    expect(await row(id)).toMatchObject({ status: 'parsed', attempts: 1 })
  })

  it('finds an item by the line’s name whole — near — and a new one where nothing is found', async () => {
    const sugar = await insertItem(db, {
      name: 'Secer kristal 1kg sunoko',
      searchKey: toSearchKey('Secer kristal 1kg sunoko'),
    })
    await insertItem(db, { name: 'Ubrus', searchKey: toSearchKey('Ubrus') })
    const me = await serb()
    const id = await taken(me)
    const journal = madeUpJournal(
      [
        { name: 'SECER KRISTAL 1KG SUNOKO KOM (Е)', price: '94,99', quantity: '2', sum: '189,98' },
        { name: 'UBRUS JUMBO 2SL 1/1 NATU KOM (Ђ)', price: '279,99', quantity: '1', sum: '279,99' },
      ],
      '469,97',
    )
    await round(office(found({ journal })))
    const lines = await db.select().from(receiptLines).where(eq(receiptLines.receiptId, id))
    const at = (position: number) => lines.find((line) => line.position === position)
    expect(at(0)).toMatchObject({ itemId: sugar, match: 'search' })
    // the brand and the pack after the kind are words the catalogue has not: new, never a guess
    expect(at(1)).toMatchObject({ itemId: null, match: 'new' })
  })
})

describe('«Записать» a receipt by its link', () => {
  async function parsedLink(me: Owner, answer = found(), url = link()): Promise<string> {
    const id = await taken(me, url)
    await round(office(answer))
    return id
  }

  function record(me: Owner, id: string, payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: `/receipts/${id}/record`,
      headers: { cookie: me.cookie, 'x-molvia-today': '2025-07-20' },
      payload,
    })
  }

  const recordBody = (place: Record<string, unknown>) => ({
    tripId: randomUUID(),
    place,
    purchasedOn: '2025-07-18',
    lines: [
      {
        position: 0,
        skip: false,
        item: { name: 'Сахар' },
        quantity: { value: '2', unit: 'piece' },
        amount: { amount: '189.98', currency: 'RSD' },
      },
      {
        position: 1,
        skip: false,
        item: { name: 'Банан' },
        quantity: { value: '1.482', unit: 'kg' },
        amount: { amount: '296.39', currency: 'RSD' },
      },
    ],
  })

  it('writes a trip in dinars on Belgrade’s day, teaches the shop’s memory, counts in its own table', async () => {
    const me = await serb()
    const id = await parsedLink(me)
    const payload = recordBody({ name: 'RODA MEGAMARKET 463', city: 'Белград' })
    const response = await record(me, id, payload)
    expect(response.statusCode).toBe(200)
    expect(receiptRecordedCodec.parse(response.json()).receipt.status).toBe('recorded')

    const [trip] = await db.select().from(trips).where(eq(trips.id, payload.tripId))
    expect(trip).toMatchObject({
      startedOn: '2025-07-18',
      currency: 'RSD',
      receiptMinor: 48_637n,
      receiptCurrency: 'RSD',
      finishedOnDeviceAt: new Date('2025-07-18T06:56:00Z'),
    })
    const memory = await db.select().from(storeMemory).where(eq(storeMemory.tin, TIN))
    expect(memory.map((word) => word.key).sort()).toEqual([
      'banana kg',
      toSearchKey('SECER KRISTAL 1KG SUNOKO KOM'),
    ])
    expect(await days()).toEqual([])
    // a new item kept new under a name of the person's is no edit: the reading gave none to correct
    expect(await taxDay()).toEqual({
      sentUnnamed: 1,
      read: 1,
      specsSkipped: 1,
      recorded: 1,
      lines: 2,
      within5m: 1,
    })
    // the same record again counts nothing
    expect((await record(me, id, payload)).statusCode).toBe(200)
    expect(await taxDay()).toMatchObject({ recorded: 1, lines: 2 })
  })

  it('counts what the person put right — the matcher’s misses — in its own table only', async () => {
    const me = await serb()
    const id = await parsedLink(me)
    const whole = recordBody({ name: 'RODA MEGAMARKET 463', city: 'Белград' })
    const payload = {
      ...whole,
      lines: [{ position: 0, skip: true }, ...whole.lines.slice(1)],
      edited: { item: [1], figures: [] },
    }
    expect((await record(me, id, payload)).statusCode).toBe(200)
    expect(await days()).toEqual([])
    expect(await taxDay()).toMatchObject({
      recorded: 1,
      lines: 2,
      linesEdited: 2,
      linesSkipped: 1,
      linesItem: 1,
    })
  })

  it('proposes the place of the same premises, never another shop of the same chain', async () => {
    const me = await serb()
    const first = await parsedLink(me)
    expect(
      (await record(me, first, recordBody({ name: 'RODA MEGAMARKET 463', city: 'Белград' })))
        .statusCode,
    ).toBe(200)

    const same = await parsedLink(me, found())
    const other = await parsedLink(me, found({ locationName: '1113400-IDEA 12' }))
    const placeOf = async (id: string) =>
      receiptDetailCodec.parse((await get(me, `/receipts/${id}`)).json()).receipt.place
    expect(await placeOf(same)).toMatchObject({
      name: 'RODA MEGAMARKET 463',
      city: 'Белград',
      tin: TIN,
    })
    expect(await placeOf(other)).toBeNull()
  })

  it('proposes the premises’ place for a receipt of a town the settings have not, and the memory’s item', async () => {
    const me = await serb()
    const first = await parsedLink(me)
    await record(me, first, recordBody({ name: 'RODA MEGAMARKET 463', city: 'Белград' }))
    const nis = await parsedLink(
      me,
      found({
        administrativeUnit: 'Ниш-Медијана',
        city: 'НИШ (МЕДИЈАНА)',
      }),
    )
    expect((await row(nis))?.city).toBeNull()
    const detail = receiptDetailCodec.parse((await get(me, `/receipts/${nis}`)).json())
    expect(detail.receipt.place?.name).toBe('RODA MEGAMARKET 463')
    expect(detail.lines.map((line) => [line.match, line.itemName])).toEqual([
      ['memory', 'Сахар'],
      ['memory', 'Банан'],
    ])
  })

  it('refuses the same receipt recorded before, by the seller’s tax number and the number', async () => {
    const me = await serb()
    // one receipt's link sent twice as two receipts — from two phones, or pasted again
    const url = link()
    const first = await parsedLink(me, found(), url)
    await record(me, first, recordBody({ name: 'RODA MEGAMARKET 463', city: 'Белград' }))
    const again = await parsedLink(me, found(), url)
    const refused = await record(
      me,
      again,
      recordBody({ name: 'RODA MEGAMARKET 463', city: 'Белград' }),
    )
    expect(refused.statusCode).toBe(409)
    expect(z.object({ code: z.string() }).parse(refused.json()).code).toBe(
      'error.receipt_recorded_before',
    )
  })
})

describe('the server’s own queue', () => {
  it('asks the tax office as a link arrives, not a minute later', async () => {
    const purs = office(found())
    const server = buildServer({ db, receiptReader: null, purs })
    await server.ready()
    try {
      const me = await serb()
      const payload = body(link())
      const response = await server.inject({
        method: 'POST',
        url: '/receipts',
        headers: { cookie: me.cookie },
        payload,
      })
      expect(response.statusCode).toBe(201)
      await vi.waitFor(async () => {
        expect((await row(payload.id))?.status).toBe('parsed')
      })
    } finally {
      await server.close()
    }
  })
})

describe('how the link came (MOL-234, owner’s В-3 «а» of MOL-233)', () => {
  it('counts each way it came when the server takes the receipt, on the receipt and in the day', async () => {
    const me = await serb()
    const ways = [
      { via: 'qr' },
      { via: 'qr', missed: false },
      { via: 'qr', missed: true },
      { via: 'paste', missed: true },
      { via: 'paste' },
      {},
    ]
    const ids: string[] = []
    for (const way of ways) {
      const payload = body(link(), way)
      expect((await send(me, payload)).statusCode).toBe(201)
      ids.push(payload.id)
    }
    expect(await taxDay()).toEqual({
      sentQr: 2,
      sentQrMissed: 1,
      sentPasteMissed: 1,
      sentPaste: 1,
      sentUnnamed: 1,
    })
    const rows = await Promise.all(ids.map((id) => row(id)))
    expect(rows.map((one) => [one?.via, one?.qrMissed])).toEqual([
      ['qr', false],
      ['qr', false],
      ['qr', true],
      ['paste', true],
      ['paste', false],
      [null, null],
    ])
    expect(await days()).toEqual([])
  })

  it('a repeat is the same receipt and counts nothing; another way under its id is a 409', async () => {
    const me = await serb()
    const payload = body(link(), { via: 'qr', missed: true })
    expect((await send(me, payload)).statusCode).toBe(201)
    expect((await send(me, payload)).statusCode).toBe(200)
    expect((await send(me, { ...payload, via: 'paste' })).statusCode).toBe(409)
    expect((await send(me, { ...payload, missed: false })).statusCode).toBe(409)
    expect(await taxDay()).toEqual({ sentQrMissed: 1 })
  })

  it('a miss with no way named is not said: a body of a build that names neither stays unnamed', async () => {
    const me = await serb()
    const payload = body(link(), { missed: true })
    expect((await send(me, payload)).statusCode).toBe(201)
    expect(await row(payload.id)).toMatchObject({ via: null, qrMissed: null })
    expect(await taxDay()).toEqual({ sentUnnamed: 1 })
  })

  it('refuses a way that is not one, at the door', async () => {
    const me = await serb()
    const response = await send(me, body(link(), { via: 'camera' }))
    expect(response.statusCode).toBe(400)
    expect(await db.select().from(taxReceiptDays)).toEqual([])
  })

  it('a photo names no way: the database holds it to the link alone', async () => {
    const me = await serb()
    const id = await taken(me)
    await expect(
      db.update(receipts).set({ source: 'photo', parts: 1, via: 'qr' }).where(eq(receipts.id, id)),
    ).rejects.toThrow()
  })
})

describe('the codes of the lines, from the specification (MOL-234, owner’s В-1 «а»)', () => {
  const CODE = '8601234567899'
  const spec = (gtins: readonly string[], totals = [18_998, 29_639]): PursSpecification => ({
    kind: 'found',
    items: totals.map((totalHundredths, at) => ({ totalHundredths, gtin: gtins[at] ?? '' })),
  })
  const codes = async (id: string) =>
    (
      await db
        .select({ gtin: receiptLines.gtin })
        .from(receiptLines)
        .where(eq(receiptLines.receiptId, id))
        .orderBy(receiptLines.position)
    ).map((line) => line.gtin)

  it('keeps the code the shop passed on its line, and counts the specification and the line', async () => {
    const me = await serb()
    const id = await taken(me)
    const purs = office()
    purs.specs.push(spec([CODE, '']))
    await round(purs)
    expect(await row(id)).toMatchObject({ status: 'parsed' })
    expect(await codes(id)).toEqual([CODE, null])
    expect(await taxDay()).toEqual({ sentUnnamed: 1, read: 1, specsOk: 1, linesCoded: 1 })
  })

  it('a specification refused or out of step gives no code, and the receipt is read all the same', async () => {
    const me = await serb()
    const refused = await taken(me)
    const astray = await taken(me)
    const purs = office()
    purs.specs.push({ kind: 'failed' }, spec([CODE, ''], [18_998, 29_640]))
    await round(purs)
    expect(await row(refused)).toMatchObject({ status: 'parsed' })
    expect(await row(astray)).toMatchObject({ status: 'parsed' })
    expect(await codes(refused)).toEqual([null, null])
    expect(await codes(astray)).toEqual([null, null])
    expect(await taxDay()).toEqual({ sentUnnamed: 2, read: 2, specsFailed: 2 })
  })

  it('a shop’s own code and one that does not check are never kept', async () => {
    const me = await serb()
    const id = await taken(me)
    const purs = office()
    purs.specs.push(spec(['2100000000012', '8601234567891']))
    await round(purs)
    expect(await codes(id)).toEqual([null, null])
    expect(await taxDay()).toMatchObject({ specsOk: 1 })
    expect(await taxDay()).not.toHaveProperty('linesCoded')
  })

  it('a line whose code an item holds is bound to that item, before the search', async () => {
    const me = await serb()
    const sugar = await insertItem(db, {
      name: 'Сахар Sunoko 1 кг',
      searchKey: toSearchKey('Сахар Sunoko 1 кг'),
    })
    await db.insert(itemBarcodes).values({ code: CODE, itemId: sugar })
    const id = await taken(me)
    const purs = office()
    purs.specs.push(spec([CODE, '']))
    await round(purs)
    const [first] = await db
      .select({ itemId: receiptLines.itemId, match: receiptLines.match })
      .from(receiptLines)
      .where(eq(receiptLines.receiptId, id))
      .orderBy(receiptLines.position)
    expect(first).toEqual({ itemId: sugar, match: 'search' })
  })

  it('the receipt is written with its codes: a review read the moment it is read has them (review 9, Б1)', async () => {
    const me = await serb()
    const id = await taken(me)
    const purs = office()
    let answer: (value: PursSpecification) => void = () => undefined
    purs.specified.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    const running = round(purs)
    await vi.waitFor(() => {
      expect(purs.specified).toHaveBeenCalledOnce()
    })
    // while the specification is out the receipt is still being read — never shown without codes
    expect(await row(id)).toMatchObject({ status: 'reading' })
    answer(spec([CODE, '']))
    await running
    expect(await row(id)).toMatchObject({ status: 'parsed', link: null })
    expect(await codes(id)).toEqual([CODE, null])
  })

  it('a specification over the person’s share is counted as not asked (adversarial А5)', async () => {
    const me = await serb()
    await taken(me)
    const purs = office()
    purs.specs.push({ kind: 'skipped' })
    await round(purs)
    expect(await taxDay()).toEqual({ sentUnnamed: 1, read: 1, specsSkipped: 1 })
  })

  it('the specification asked with the receipt’s own number and person', async () => {
    const me = await serb()
    const url = link()
    await taken(me, url)
    const purs = office()
    await round(purs)
    const signed = serbianReceiptLink(url)
    expect(signed.ok && signed.number).toBeTruthy()
    expect(purs.specified).toHaveBeenCalledWith(url, signed.ok ? signed.number : '', me.id)
  })
})

describe('«Привязать штрихкоды?» at «Записать» (MOL-234, owner’s В-2 «а»)', () => {
  const CODE = '8601234567899'
  const coded: PursSpecification = {
    kind: 'found',
    items: [
      { totalHundredths: 18_998, gtin: CODE },
      { totalHundredths: 29_639, gtin: '' },
    ],
  }

  async function codedReceipt(me: Owner): Promise<string> {
    const id = await taken(me)
    const purs = office()
    purs.specs.push(coded)
    await round(purs)
    return id
  }

  /** As a phone of this build asks: it knows a line's `code` (adversarial А3). */
  const review = async (me: Owner, id: string, codes = true) =>
    receiptDetailCodec.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/receipts/${id}`,
          headers: { cookie: me.cookie, ...(codes ? { [RECEIPT_CODES_HEADER]: '1' } : {}) },
        })
      ).json(),
    )

  function record(me: Owner, id: string, payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: `/receipts/${id}/record`,
      headers: { cookie: me.cookie, 'x-molvia-today': '2025-07-20' },
      payload,
    })
  }

  const body = (sugar: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    tripId: randomUUID(),
    place: { name: 'RODA MEGAMARKET 463', city: 'Белград' },
    purchasedOn: '2025-07-18',
    lines: [
      {
        position: 0,
        skip: false,
        item: sugar,
        quantity: { value: '2', unit: 'piece' },
        amount: { amount: '189.98', currency: 'RSD' },
      },
      {
        position: 1,
        skip: false,
        item: { name: 'Банан' },
        quantity: { value: '1.482', unit: 'kg' },
        amount: { amount: '296.39', currency: 'RSD' },
      },
    ],
    ...over,
  })

  const holders = () =>
    db
      .select({
        code: itemBarcodes.code,
        itemId: itemBarcodes.itemId,
        addedBy: itemBarcodes.addedBy,
      })
      .from(itemBarcodes)

  async function item(name: string, codes: readonly string[] = []): Promise<string> {
    const id = await insertItem(db, { name, searchKey: toSearchKey(name) })
    if (codes.length > 0) {
      await db.insert(itemBarcodes).values(codes.map((code) => ({ code, itemId: id })))
    }
    return id
  }

  it('shows the code on the review of the line whose item does not hold it, and no other', async () => {
    const me = await serb()
    const id = await codedReceipt(me)
    const lines = (await review(me, id)).lines
    expect(lines[0]?.code).toBe(CODE)
    expect(lines[1]).not.toHaveProperty('code')
  })

  it('gives no code to a phone that did not ask: an earlier build reads a line strictly (А3)', async () => {
    const me = await serb()
    const id = await codedReceipt(me)
    const lines = (await review(me, id, false)).lines
    expect(lines.every((line) => !('code' in line))).toBe(true)
  })

  it('asks nothing when another item holds the code: its answer could only be «held» (review 3)', async () => {
    const me = await serb()
    const id = await codedReceipt(me)
    // the code went to another item after the receipt was read — a scan, or another receipt recorded
    const cookie = await item('Печенье', [CODE])
    const [first] = (await review(me, id)).lines
    expect(first?.itemId).not.toBe(cookie)
    expect(first).not.toHaveProperty('code')
  })

  it('asks nothing of a line found by its code: the item holds it', async () => {
    const me = await serb()
    const sugar = await item('Сахар Sunoko 1 кг', [CODE])
    const id = await codedReceipt(me)
    const [first] = (await review(me, id)).lines
    expect(first?.itemId).toBe(sugar)
    expect(first).not.toHaveProperty('code')
  })

  it('binds the code to a new item recorded, by the person, and counts it', async () => {
    const me = await serb()
    const id = await codedReceipt(me)
    const response = await record(me, id, body({ name: 'Сахар Sunoko' }, { barcodes: [0] }))
    expect(response.statusCode).toBe(200)
    const answer = receiptRecordedCodec.parse(response.json())
    expect(answer.codes).toEqual([{ position: 0, code: CODE, outcome: 'written' }])
    const [written] = await holders()
    expect(written).toMatchObject({ code: CODE, addedBy: me.id })
    expect(await taxDay()).toMatchObject({ recorded: 1, codesWritten: 1 })
  })

  it('binds it to an item of the catalogue the person chose', async () => {
    const me = await serb()
    const sugar = await item('Сахар')
    const id = await codedReceipt(me)
    const response = await record(me, id, body({ id: sugar }, { barcodes: [0] }))
    expect(receiptRecordedCodec.parse(response.json()).codes).toEqual([
      { position: 0, code: CODE, outcome: 'written' },
    ])
    expect(await holders()).toEqual([{ code: CODE, itemId: sugar, addedBy: me.id }])
  })

  it('writes nothing without the person’s yes — and answers no codes', async () => {
    const me = await serb()
    const id = await codedReceipt(me)
    const response = await record(me, id, body({ name: 'Сахар Sunoko' }))
    expect(response.statusCode).toBe(200)
    expect(response.json()).not.toHaveProperty('codes')
    expect(await holders()).toEqual([])
    expect(await taxDay()).toMatchObject({ recorded: 1 })
    expect(await taxDay()).not.toHaveProperty('codesWritten')
  })

  it('a code another item holds is named and not written; the receipt is recorded all the same', async () => {
    const me = await serb()
    const other = await item('Печенье', [CODE])
    const sugar = await item('Сахар')
    const id = await taken(me)
    const purs = office()
    purs.specs.push(coded)
    await round(purs)
    const response = await record(me, id, body({ id: sugar }, { barcodes: [0] }))
    expect(response.statusCode).toBe(200)
    expect(receiptRecordedCodec.parse(response.json())).toMatchObject({
      receipt: { status: 'recorded' },
      codes: [{ position: 0, code: CODE, outcome: 'held', holder: 'Печенье' }],
    })
    expect(await holders()).toEqual([{ code: CODE, itemId: other, addedBy: null }])
    expect(await taxDay()).not.toHaveProperty('codesWritten')
  })

  it('a record sent again answers its codes again — the first answer may be lost (adversarial А2)', async () => {
    const me = await serb()
    await item('Печенье', [CODE])
    const sugar = await item('Сахар')
    const id = await codedReceipt(me)
    const payload = body({ id: sugar }, { barcodes: [0] })
    const first = receiptRecordedCodec.parse((await record(me, id, payload)).json())
    const again = receiptRecordedCodec.parse((await record(me, id, payload)).json())
    expect(first.codes).toEqual([{ position: 0, code: CODE, outcome: 'held', holder: 'Печенье' }])
    expect(again).toEqual(first)
  })

  // MOL-240: the line not recorded goes at «Записать», so the recorded lines have a gap before this one
  it('a record sent again finds a code by its line’s position, past a line not recorded', async () => {
    const me = await serb()
    const sugar = await item('Сахар')
    const id = await taken(me)
    const purs = office()
    purs.specs.push({
      kind: 'found',
      items: [
        { totalHundredths: 18_998, gtin: '' },
        { totalHundredths: 29_639, gtin: CODE },
      ],
    })
    await round(purs)
    const payload = body(
      {},
      {
        lines: [
          { position: 0, skip: true },
          {
            position: 1,
            skip: false,
            item: { id: sugar },
            quantity: { value: '1.482', unit: 'kg' },
            amount: { amount: '296.39', currency: 'RSD' },
          },
        ],
        barcodes: [1],
      },
    )
    const first = receiptRecordedCodec.parse((await record(me, id, payload)).json())
    expect(first.codes).toEqual([{ position: 1, code: CODE, outcome: 'written' }])
    const again = receiptRecordedCodec.parse((await record(me, id, payload)).json())
    expect(again.codes).toEqual(first.codes)
  })

  it('a record sent again tells a code written as written', async () => {
    const me = await serb()
    const sugar = await item('Сахар')
    const id = await codedReceipt(me)
    const payload = body({ id: sugar }, { barcodes: [0] })
    await record(me, id, payload)
    const again = receiptRecordedCodec.parse((await record(me, id, payload)).json())
    expect(again.codes).toEqual([{ position: 0, code: CODE, outcome: 'written' }])
  })

  it('an item holding twenty takes no more, and the record stands', async () => {
    const me = await serb()
    const full = Array.from({ length: 20 }, (_, n) => {
      const twelve = `86099900${String(n).padStart(4, '0')}`
      let sum = 0
      for (let at = 0; at < 12; at += 1) sum += Number(twelve[11 - at]) * (at % 2 ? 1 : 3)
      return `${twelve}${String((10 - (sum % 10)) % 10)}`
    })
    const sugar = await item('Сахар', full)
    const id = await codedReceipt(me)
    const response = await record(me, id, body({ id: sugar }, { barcodes: [0] }))
    expect(response.statusCode).toBe(200)
    expect(receiptRecordedCodec.parse(response.json()).codes).toEqual([
      { position: 0, code: CODE, outcome: 'full' },
    ])
  })

  it('a position with no code, or a line left out, binds nothing', async () => {
    const me = await serb()
    const id = await codedReceipt(me)
    const skipped = body({ name: 'Сахар' }, { barcodes: [0, 1] })
    skipped.lines = [{ position: 0, skip: true } as never, ...skipped.lines.slice(1)]
    const response = await record(me, id, skipped)
    expect(response.statusCode).toBe(200)
    expect(receiptRecordedCodec.parse(response.json()).codes).toEqual([])
    expect(await holders()).toEqual([])
  })
})
