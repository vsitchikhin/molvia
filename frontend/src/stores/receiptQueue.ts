import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { ApiError } from '@molvia/client'
import {
  ERROR,
  RECEIPT_PARTS_MAX,
  isWireCode,
  receiptBodySchema,
  receiptRecordBodySchema,
} from '@molvia/model'
import type {
  ReceiptBody,
  ReceiptLinkBody,
  ReceiptPhotoBody,
  ReceiptRecordBody,
  WireCode,
} from '@molvia/model'
import { api } from '@/api'
import { photoShelf } from '@/receipts/photoShelf'
import { useActorStore } from '@/stores/actor'
import { useLoginStore } from '@/stores/login'
import { isIdentifier } from '@/stores/identity'
import { HOLDS, doublingRetry, exclusively, isRecord, newKey } from '@/stores/queueing'
import type { Loose } from '@/stores/queueing'
import { read, write, writeEverywhere } from '@/stores/storage'

/**
 * One write of a receipt, kept until the server has it (MOL-127): the receipt announced, each of its
 * parts, a removal and its «Вернуть», and «Записать». One queue for all five, so the parts go after
 * the receipt that names them and «Записать» never overtakes a removal.
 *
 * A part carries no bytes: they are on the photo shelf (`photoShelf`), put there before the write
 * that names them, and read when it is sent.
 */
export type ReceiptWrite =
  | { readonly kind: 'create'; readonly body: ReceiptBody }
  | { readonly kind: 'part'; readonly id: string; readonly part: number }
  | { readonly kind: 'remove'; readonly id: string }
  | { readonly kind: 'restore'; readonly id: string }
  | { readonly kind: 'record'; readonly id: string; readonly body: ReceiptRecordBody }

export interface RejectedReceiptWrite {
  readonly key: string
  readonly write: ReceiptWrite
  /**
   * The server's refusal, or `error.not_found` for a photo the phone no longer has — a part cannot
   * be sent without it, and the person is told the same way: «не принят».
   */
  readonly code: WireCode
  /** When it was refused: the row of «не принят» is dated by it, never by the moment it is drawn. */
  readonly at: number
}

/**
 * What «Вернуть» needs: the receipt, and the writes taken out of the queue with it — the whole receipt
 * when nobody had begun to send it (`local`), or its parts still waiting once the announcement left.
 */
export interface ReceiptUndo {
  readonly id: string
  readonly writes?: readonly ReceiptWrite[]
  /** The server never heard of it: its photos go off the phone with the strip. */
  readonly local?: true
}

/** The receipt whose purchases were just written, and where they are. */
export interface ReceiptRecordedNote {
  readonly receiptId: string
  readonly tripId: string
  readonly count: number
}

interface Kept {
  readonly key: string
  readonly write: ReceiptWrite
  /** A send of it has begun and its answer may have been lost (as in the spendings' queue). */
  readonly attempted?: true
}

const QUEUE_KEY = 'molvia.receipt-queue'
const REJECTED_KEY = 'molvia.receipt-rejected'
const DELIVERED_KEY = 'molvia.receipt-delivered'
/** As long as the server keeps a receipt not recorded (В-3): nothing to remember past it. */
const DELIVERED_MS = 28 * 24 * 60 * 60 * 1000

/**
 * A part of a receipt the server no longer has — removed on another phone — has nowhere to go and is
 * done; so is a removal of one it does not know, and «Вернуть» after the ten minutes, which leaves
 * the receipt removed: nothing on screen would put it right.
 */
const DONE_ENOUGH: Partial<Record<ReceiptWrite['kind'], readonly WireCode[]>> = {
  part: [ERROR.NOT_FOUND],
  // A recorded receipt is not removed (409 of MOL-126): its purchases are in «Записаны», and a refusal
  // drawn as «не принят» would speak of a photo about a receipt that is there (adversarial А1).
  remove: [ERROR.NOT_FOUND, ERROR.CONFLICT],
  restore: [ERROR.NOT_FOUND],
}

/** A photo the shelf has lost: refused here, as the server would refuse a part it never got. */
class PhotoLost extends Error {}

/** Every write is about one receipt. */
export function receiptOf(write: ReceiptWrite): string {
  return write.kind === 'create' ? write.body.id : write.id
}

function encode(write: ReceiptWrite): Loose {
  switch (write.kind) {
    case 'create':
      return { kind: write.kind, body: receiptBodySchema.encode(write.body) }
    case 'record':
      return { kind: write.kind, id: write.id, body: receiptRecordBodySchema.encode(write.body) }
    default:
      return { ...write }
  }
}

/** Through the bodies' own schemas, so a write the server would refuse never waits for a signal. */
function decode(raw: unknown): ReceiptWrite | null {
  if (!isRecord(raw)) return null
  const { kind, id } = raw
  if (kind === 'create') {
    const body = receiptBodySchema.safeParse(raw.body)
    return body.success ? { kind, body: body.data } : null
  }
  if (typeof id !== 'string' || !isIdentifier(id)) return null
  if (kind === 'part') {
    const { part } = raw
    return typeof part === 'number' &&
      Number.isInteger(part) &&
      part >= 1 &&
      part <= RECEIPT_PARTS_MAX
      ? { kind, id, part }
      : null
  }
  if (kind === 'record') {
    const body = receiptRecordBodySchema.safeParse(raw.body)
    return body.success ? { kind, id, body: body.data } : null
  }
  if (kind === 'remove' || kind === 'restore') return { kind, id }
  return null
}

function parsedList(key: string): unknown[] {
  const raw = read(key)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** The part of a kept queue still waiting: its past, less what has been sent since. */
function stillWaiting(past: string, waiting: ReadonlySet<string>): string | null {
  let entries: unknown
  try {
    entries = JSON.parse(past)
  } catch {
    return null
  }
  if (!Array.isArray(entries)) return null
  const left = entries.filter(
    (item: unknown) => isRecord(item) && typeof item.key === 'string' && waiting.has(item.key),
  )
  if (left.length === entries.length) return past
  return left.length > 0 ? JSON.stringify(left) : null
}

/** A broken entry is dropped alone: the ones around it are somebody's receipts. */
function recallKept(key: string): Kept[] {
  return parsedList(key).flatMap((item: unknown) => {
    if (!isRecord(item) || typeof item.key !== 'string') return []
    const write = decode(item.write)
    if (!write) return []
    return [
      item.attempted === true
        ? { key: item.key, write, attempted: true }
        : { key: item.key, write },
    ]
  })
}

function recallRejected(key: string): RejectedReceiptWrite[] {
  return parsedList(key).flatMap((item: unknown) => {
    if (!isRecord(item) || typeof item.key !== 'string' || !isWireCode(item.code)) return []
    const write = decode(item.write)
    const at = typeof item.at === 'number' ? item.at : 0
    return write ? [{ key: item.key, write, code: item.code, at }] : []
  })
}

/** The receipts whose every part this phone delivered, by when the last one landed. */
function recallDelivered(key: string): Record<string, number> {
  const raw = read(key)
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!isRecord(parsed)) return {}
  const since = Date.now() - DELIVERED_MS
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, number] =>
        isIdentifier(entry[0]) && typeof entry[1] === 'number' && entry[1] > since,
    ),
  )
}

/**
 * Runs `work` while no window is sending this owner's receipts — «Выйти» erases the queue and the
 * photos under it, as it does the trip's and the spendings' (MOL-57).
 */
export function whileReceiptsAreStill(owner: string, work: () => Promise<void>): Promise<void> {
  return exclusively(`${QUEUE_KEY}.${owner}`, work)
}

/**
 * Every write of a receipt goes through here, with a connection or without one, by the rules of the
 * trip's queue (MOL-24): **storage is the queue**, every window reads it before each change and send,
 * takes out only the write it sent, and one window sends at a time under `navigator.locks`. No
 * connection, a 5xx, a portal, a `401` and a code the API did not say hold it; `413` and `415` —
 * «не принят» — and every other refusal are set aside and never sent again. **A repeat is safe**: the
 * phone names the receipt and the trip «Записать» makes, and a part sent again with the same bytes is
 * the same part.
 *
 * Nothing is tried while the browser knows there is no connection (as the spendings' queue): a
 * receipt taken at the till with no signal stays unmarked, so removing it takes it out of the queue
 * whole rather than asking the server to remove what it never had.
 */
export const useReceiptQueueStore = defineStore('receiptQueue', () => {
  const actor = useActorStore()
  const login = useLoginStore()

  let kept: Kept[] = []
  const pending = ref<ReceiptWrite[]>([])
  const rejected = ref<RejectedReceiptWrite[]>([])
  /** How many writes the server has answered in this window — the screens read again. */
  const landed = ref(0)
  /** The receipts recorded in this window, by the answer of «Записать» (Т-12). */
  const recorded = ref<ReceiptRecordedNote[]>([])
  /**
   * The receipt just removed, offered back for the ten seconds of its strip on «Покупки», wherever it
   * was removed from (as a trip's and a spending's are). The server keeps the removal ten minutes.
   */
  const lastRemoved = ref<{
    readonly undo: ReceiptUndo
    readonly stamp: number
    /** The seconds the strip had left at `at`, as the strip reports them. */
    readonly left: number
    readonly at: number
  } | null>(null)
  /**
   * The receipts this phone delivered whole (review 29, adversarial Б1): a list read before the last
   * part landed still says «uploading», and such a receipt is being read, never «не все части
   * дошли». The server never goes back to `uploading` after the last part, so the list read later
   * says so itself; kept on the phone, since that read may be a restart away with no connection.
   */
  const delivered = ref<Record<string, number>>({})
  /** When «Отправить чек» last queued a receipt here: «Чек отправлен» stands for a moment (3d). */
  const sentAt = ref<number | null>(null)
  let ahead = false
  /** The key of the write a send is carrying right now: it is never taken out. */
  let inFlight: string | null = null
  /** The receipt that write is about, for a screen to offer nothing it cannot take back. */
  const carrying = ref<string | null>(null)

  function show(): void {
    pending.value = kept.map((item) => item.write)
  }

  function sync(id: string | null): void {
    if (!id || ahead) return
    kept = recallKept(`${QUEUE_KEY}.${id}`)
    rejected.value = recallRejected(`${REJECTED_KEY}.${id}`)
    delivered.value = recallDelivered(`${DELIVERED_KEY}.${id}`)
    show()
  }

  function persist(id: string | null): void {
    show()
    if (!id) return
    const queued = writeEverywhere(
      `${QUEUE_KEY}.${id}`,
      JSON.stringify(
        kept.map((item) => ({
          key: item.key,
          write: encode(item.write),
          ...(item.attempted ? { attempted: true } : {}),
        })),
      ),
      (past) => stillWaiting(past, new Set(kept.map((item) => item.key))),
    )
    const refused = writeEverywhere(
      `${REJECTED_KEY}.${id}`,
      JSON.stringify(
        rejected.value.map((item) => ({
          key: item.key,
          write: encode(item.write),
          code: item.code,
          at: item.at,
        })),
      ),
      (past) => past,
    )
    ahead = !queued || !refused
  }

  function load(id: string | null): void {
    ahead = false
    inFlight = null
    carrying.value = null
    kept = []
    rejected.value = []
    delivered.value = {}
    recorded.value = []
    lastRemoved.value = null
    sync(id)
    show()
  }

  load(actor.id)
  watch(
    () => actor.id,
    (id) => {
      load(id)
      void flush()
    },
  )

  window.addEventListener('storage', (event) => {
    const id = actor.id
    if (
      id &&
      (event.key === `${QUEUE_KEY}.${id}` ||
        event.key === `${REJECTED_KEY}.${id}` ||
        event.key === `${DELIVERED_KEY}.${id}`)
    ) {
      sync(id)
      landed.value++
    }
  })

  const retry = doublingRetry(() => void attempt())

  async function attempt(): Promise<void> {
    if (actor.state === 'error') await actor.retry()
    await flush()
  }

  let running: Promise<void> | null = null

  /** One run at a time, and only once the server has said who we are (MOL-56). */
  function flush(): Promise<void> {
    if (actor.state !== 'ready' || login.writesHeld) {
      if (actor.state === 'error') retry.later()
      return Promise.resolve()
    }
    if (!running) {
      const owner = actor.id
      retry.cancel()
      const run = owner
        ? exclusively(`${QUEUE_KEY}.${owner}`, () => drain(owner))
        : Promise.resolve()
      running = run.finally(() => {
        running = null
        if (actor.id !== owner) void flush()
      })
    }
    return running
  }

  async function send(owner: string, write: ReceiptWrite): Promise<void> {
    switch (write.kind) {
      case 'create':
        await api.sendReceipt(write.body)
        return
      case 'part': {
        const photo = await photoShelf(owner).get(write.id, write.part)
        if (!photo) throw new PhotoLost()
        await api.putReceiptPart(write.id, write.part, photo)
        return
      }
      case 'remove':
        await api.removeReceipt(write.id)
        return
      case 'restore':
        await api.restoreReceipt(write.id)
        return
      case 'record': {
        const answer = await api.recordReceipt(write.id, write.body)
        const count = write.body.lines.filter((line) => !line.skip).length
        recorded.value = [
          ...recorded.value.filter((note) => note.receiptId !== write.id),
          { receiptId: write.id, tripId: answer.tripId, count },
        ]
        // The photo goes off the phone with the receipt it was (Т-4, MOL-126 Т-12).
        await photoShelf(owner).drop(write.id)
        return
      }
    }
  }

  async function drain(owner: string): Promise<void> {
    for (;;) {
      if (actor.id !== owner) return
      sync(owner)
      const head = kept[0]
      if (!head) break
      if (!navigator.onLine) return

      let refusal: WireCode | null = null
      const tried = head.attempted === true
      if (!tried) {
        kept = kept.map((item) => (item.key === head.key ? { ...item, attempted: true } : item))
        persist(owner)
      }
      inFlight = head.key
      carrying.value = receiptOf(head.write)
      try {
        await send(owner, head.write)
      } catch (error) {
        if (error instanceof PhotoLost) {
          refusal = ERROR.NOT_FOUND
        } else {
          const known = error instanceof ApiError
          const code = known ? error.code : ERROR.INTERNAL
          if (!known || !error.answered || HOLDS.includes(code)) {
            if (known && !error.answered && code !== ERROR.INTERNAL && !tried)
              unmark(owner, head.key)
            if (code !== ERROR.NO_ACTOR) retry.later()
            return
          }
          refusal = DONE_ENOUGH[head.write.kind]?.includes(code) ? null : code
        }
      } finally {
        inFlight = null
        carrying.value = null
      }
      if (actor.id !== owner) return

      sync(owner)
      const write = head.write
      kept = kept.filter((item) => item.key !== head.key)
      if (refusal) {
        console.warn(`[receipt queue] ${write.kind} refused: ${refusal}`)
        // A receipt refused, or a part of it, takes the parts behind it along: they belong to a
        // receipt that will not be read. The person sees one row, «не принят», and removes it.
        if (write.kind === 'create' || write.kind === 'part') {
          const id = receiptOf(write)
          kept = kept.filter((item) => !(item.write.kind === 'part' && item.write.id === id))
        }
        rejected.value = [
          ...rejected.value,
          { key: newKey(), write, code: refusal, at: Date.now() },
        ]
      } else if (write.kind === 'create' && 'link' in write.body) {
        // a receipt by its link is whole as it lands: no part follows it (MOL-232)
        keepDelivered(owner, { ...delivered.value, [write.body.id]: Date.now() })
      } else if (
        write.kind === 'part' &&
        !kept.some(
          (item) =>
            (item.write.kind === 'create' || item.write.kind === 'part') &&
            receiptOf(item.write) === write.id,
        )
      ) {
        keepDelivered(owner, { ...delivered.value, [write.id]: Date.now() })
      }
      persist(owner)
      landed.value++
    }
    retry.reset()
  }

  function keepDelivered(owner: string, next: Record<string, number>): void {
    delivered.value = next
    write(`${DELIVERED_KEY}.${owner}`, JSON.stringify(next))
  }

  /** The list said where these are now: no older answer is in doubt about them any more. */
  function settleDelivered(ids: ReadonlySet<string>): void {
    const owner = actor.id
    if (!owner) return
    const now = recallDelivered(`${DELIVERED_KEY}.${owner}`)
    if (!Object.keys(now).some((id) => ids.has(id))) return
    keepDelivered(owner, Object.fromEntries(Object.entries(now).filter(([id]) => !ids.has(id))))
  }

  function unmark(owner: string, key: string): void {
    sync(owner)
    kept = kept.map((item) => (item.key === key ? { key: item.key, write: item.write } : item))
    persist(owner)
  }

  function change(work: () => void): void {
    const id = actor.id
    sync(id)
    work()
    persist(id)
    void flush()
  }

  /** Neither on its way nor ever on its way: only such a write may be taken out. */
  const waiting = (item: Kept) => item.key !== inFlight && !item.attempted

  /**
   * «Отправить чек»: the photos onto the shelf first, then the writes that name them. False — the
   * phone had nowhere to keep a photo, and nothing is queued: a receipt without its photos is not one.
   */
  async function capture(body: ReceiptPhotoBody, photos: readonly Blob[]): Promise<boolean> {
    const owner = actor.id
    if (!owner || photos.length !== body.parts) return false
    const shelf = photoShelf(owner)
    for (const [index, photo] of photos.entries()) {
      if (!(await shelf.put(body.id, index + 1, photo))) {
        await shelf.drop(body.id)
        return false
      }
    }
    change(() => {
      kept = [
        ...kept,
        { key: newKey(), write: { kind: 'create', body } },
        ...photos.map((_, index) => ({
          key: newKey(),
          write: { kind: 'part', id: body.id, part: index + 1 } as const,
        })),
      ]
    })
    sentAt.value = Date.now()
    return true
  }

  /**
   * «Отправить чек» by its link (MOL-232): one write, no photo — the server asks the tax office. False
   * with nobody signed in, as `capture`.
   */
  function sendLink(body: ReceiptLinkBody): boolean {
    if (!actor.id) return false
    change(() => {
      kept = [...kept, { key: newKey(), write: { kind: 'create', body } }]
    })
    sentAt.value = Date.now()
    return true
  }

  /**
   * «Удалить чек», without a question. A receipt nobody has begun to send never reached the server:
   * its writes are taken out of the queue, and «Вернуть» puts them back. Once a send has begun it may
   * be there, so the removal goes to the server, and 404 on it is done. A refusal about the receipt
   * goes with it — there is nothing left to fix. `quiet` — «Переснять» (П-3): no strip, and the
   * photos of one that never left go at once.
   */
  function remove(id: string, quiet = false): ReceiptUndo {
    let undo: ReceiptUndo = { id }
    change(() => {
      rejected.value = rejected.value.filter((item) => receiptOf(item.write) !== id)
      const own = kept.filter(
        (item) =>
          (item.write.kind === 'create' || item.write.kind === 'part') &&
          receiptOf(item.write) === id,
      )
      if (own.some((item) => item.write.kind === 'create') && own.every(waiting)) {
        kept = kept.filter((item) => !own.includes(item))
        undo = { id, writes: own.map((item) => item.write), local: true }
        return
      }
      // The announcement left: the parts still waiting go out of the queue with the removal, and
      // «Вернуть» puts them back — a photo the person removed is not uploaded meanwhile (А3).
      const parts = own.filter(waiting)
      kept = kept.filter((item) => !parts.includes(item))
      if (parts.length > 0) undo = { id, writes: parts.map((item) => item.write) }
      if (
        kept.some((item) => waiting(item) && item.write.kind === 'remove' && item.write.id === id)
      )
        return
      kept = [...kept, { key: newKey(), write: { kind: 'remove', id } }]
    })
    // «Переснять» removes the receipt it replaces with no strip: the person asked for a new one.
    const owner = actor.id
    if (!quiet) lastRemoved.value = { undo, stamp: Date.now(), left: 0, at: Date.now() }
    else if (owner && undo.local) void photoShelf(owner).drop(id)
    return undo
  }

  /** «Вернуть»: what was taken out put back; the waiting removal taken back, or a restore sent. */
  function restore(undo: ReceiptUndo): void {
    change(() => {
      if (undo.local && undo.writes) {
        kept = [...kept, ...undo.writes.map((write) => ({ key: newKey(), write }))]
        return
      }
      const at = kept.findIndex(
        (item) => waiting(item) && item.write.kind === 'remove' && item.write.id === undo.id,
      )
      kept =
        at === -1
          ? [...kept, { key: newKey(), write: { kind: 'restore', id: undo.id } }]
          : kept.filter((_, index) => index !== at)
      // The parts taken out with the removal go after whatever brings the receipt back.
      if (undo.writes) kept = [...kept, ...undo.writes.map((write) => ({ key: newKey(), write }))]
    })
    if (lastRemoved.value?.undo.id === undo.id) lastRemoved.value = null
  }

  /** The strip went: what it offered is gone, and a receipt that never left takes its photos along. */
  function forgetRemoved(left = 0): void {
    const last = lastRemoved.value
    if (!last) return
    if (left > 0) {
      lastRemoved.value = { ...last, left, at: Date.now() }
      return
    }
    lastRemoved.value = null
    const owner = actor.id
    if (owner && last.undo.local) void photoShelf(owner).drop(last.undo.id)
  }

  /**
   * «Записать N» (Т-12): the whole receipt as the phone holds it, under the trip it names. Tapped
   * twice, or sent again after a lost answer, it is one record. A refusal of an earlier one about the
   * same receipt goes: this is the person's answer to it.
   */
  function record(id: string, body: ReceiptRecordBody): void {
    change(() => {
      rejected.value = rejected.value.filter(
        (item) => !(item.write.kind === 'record' && item.write.id === id),
      )
      if (kept.some((item) => item.write.kind === 'record' && item.write.id === id)) return
      kept = [...kept, { key: newKey(), write: { kind: 'record', id, body } }]
    })
  }

  /**
   * Whether a send of this receipt's record has begun, in this window or another: the mark is in
   * storage, set before the send. Such a record may have landed with its answer lost, so it is
   * cancelled only once the server says the receipt is not recorded (MOL-169, adversarial А1–А4).
   */
  function recordBegun(id: string): boolean {
    sync(actor.id)
    return kept.some(
      (item) =>
        item.write.kind === 'record' &&
        item.write.id === id &&
        (item.attempted === true || item.key === inFlight),
    )
  }

  /**
   * «Отменить запись» (MOL-169, owner's В-5): the record of this receipt out of the queue, the review
   * open again with its draft. Never the one a send carries right now; one begun before only through
   * `cancelChecked`, on the server's word under the queue's lock (`recordBegun`). False — it stays.
   */
  function cancelRecord(id: string): boolean {
    return takeRecord(id, false)
  }

  function takeRecord(id: string, checked: boolean): boolean {
    let taken = false
    change(() => {
      const left = kept.filter(
        (item) =>
          item.key === inFlight ||
          (item.attempted === true && !checked) ||
          !(item.write.kind === 'record' && item.write.id === id),
      )
      taken = left.length < kept.length
      kept = left
    })
    return taken
  }

  /**
   * A begun record cancelled on the server's word that the receipt is not recorded — asked under the
   * lock every window sends under, so no send of it is still on its way, in this window or another,
   * when the server answers (adversarial Б1: a second window asked while the first one's send was
   * still committing, heard «not recorded», and opened «Удалить» over purchases about to land).
   * `notRecorded` asks the server; whatever it throws comes out of here.
   */
  async function cancelChecked(id: string, notRecorded: () => Promise<boolean>): Promise<boolean> {
    const owner = actor.id
    if (!owner) return false
    let taken = false
    await exclusively(`${QUEUE_KEY}.${owner}`, async () => {
      if (await notRecorded()) taken = takeRecord(id, true)
    })
    return taken
  }

  /**
   * The server says these receipts are recorded: a record still waiting for one of them, and a refusal
   * of one — a 409 after a record cancelled had landed — have nothing left to do, and would keep the
   * receipt's photo and draft on the phone with no row to remove them from (review 1, adversarial А2).
   */
  function settleRecorded(ids: ReadonlySet<string>): void {
    const owner = actor.id
    if (!owner) return
    sync(owner)
    const done = (write: ReceiptWrite) => write.kind === 'record' && ids.has(write.id)
    const left = kept.filter((item) => item.key === inFlight || !done(item.write))
    const refused = rejected.value.filter((item) => !done(item.write))
    if (left.length === kept.length && refused.length === rejected.value.length) return
    kept = left
    rejected.value = refused
    persist(owner)
  }

  /** «Убрать» a refusal: the write is gone for good; a receipt the server may hold is removed too. */
  function dismiss(item: RejectedReceiptWrite): void {
    const id = receiptOf(item.write)
    const owner = actor.id
    change(() => {
      rejected.value = rejected.value.filter((entry) => entry.key !== item.key)
      // A receipt announced and then refused a part is on the server, waiting for parts that will
      // never come: it goes as the person asked (404 — it never got there — is done).
      if (item.write.kind === 'part' || item.write.kind === 'create')
        kept = [...kept, { key: newKey(), write: { kind: 'remove', id } }]
    })
    if (owner && item.write.kind !== 'record') void photoShelf(owner).drop(id)
  }

  return {
    pending,
    rejected,
    landed,
    recorded,
    carrying,
    lastRemoved,
    sentAt,
    delivered,
    settleDelivered,
    flush,
    capture,
    sendLink,
    remove,
    restore,
    forgetRemoved,
    record,
    recordBegun,
    cancelRecord,
    cancelChecked,
    settleRecorded,
    dismiss,
  }
})
