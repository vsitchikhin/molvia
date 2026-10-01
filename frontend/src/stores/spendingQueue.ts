import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { ApiError } from '@molvia/client'
import {
  ERROR,
  isWireCode,
  spendingAmendBodySchema,
  spendingBodySchema,
  spendingCategoryBodySchema,
} from '@molvia/model'
import type { SpendingAmendBody, SpendingBody, SpendingCategoryBody, WireCode } from '@molvia/model'
import { api } from '@/api'
import { useActorStore } from '@/stores/actor'
import { useLoginStore } from '@/stores/login'
import { isIdentifier } from '@/stores/identity'
import {
  HOLDS,
  doublingRetry,
  exclusively,
  isRecord,
  landedAgain,
  newKey,
  recallLanded,
} from '@/stores/queueing'
import type { Landed } from '@/stores/queueing'
import type { Loose } from '@/stores/queueing'
import { read, writeEverywhere } from '@/stores/storage'

/** The fields of a spending as the sheet makes them, whether it is new or amended. */
export type SpendingFields = Omit<SpendingBody, 'id'>

/**
 * One write of «Деньги», kept until the server has it (MOL-82): a spending recorded, amended,
 * removed or brought back, and one's own categories (В-4) — in the same queue, so a category made
 * at the till with no signal goes before the spending that names it.
 */
export type SpendingWrite =
  | { readonly kind: 'record'; readonly body: SpendingBody }
  | { readonly kind: 'amend'; readonly id: string; readonly body: SpendingAmendBody }
  | { readonly kind: 'remove'; readonly id: string }
  | { readonly kind: 'restore'; readonly id: string }
  | { readonly kind: 'category-add'; readonly body: SpendingCategoryBody }
  | { readonly kind: 'category-archive'; readonly id: string }
  | { readonly kind: 'category-restore'; readonly id: string }

export interface RejectedSpendingWrite {
  readonly key: string
  readonly write: SpendingWrite
  readonly code: WireCode
}

/** What «Вернуть» needs to undo a removal: the spending it was about. */
export interface SpendingUndo {
  readonly id: string
  /** The writes taken out with a spending nobody had begun to send, put back as they were. */
  readonly writes?: readonly SpendingWrite[]
}

interface Kept {
  readonly key: string
  readonly write: SpendingWrite
  /**
   * A send of it has begun — in this window or another, and its answer may have been lost. Such a
   * write may have landed, so nothing is ever folded into it or taken out in its place: «not sent»
   * and «no answer» are one thing to a queue, and only the server can tell them apart (adversarial
   * А, В). Kept in storage, since the window that sends it is not always the window that changes.
   */
  readonly attempted?: true
}

const QUEUE_KEY = 'molvia.spending-queue'
const REJECTED_KEY = 'molvia.spending-rejected'
const GONE_KEY = 'molvia.spending-gone'

/** A removal of a spending the server does not have is what was asked for (as in the trip's). */
const DONE_ENOUGH: Partial<Record<SpendingWrite['kind'], readonly WireCode[]>> = {
  remove: [ERROR.NOT_FOUND],
}

/** Which spending a write is about, or null for a category. */
export function spendingOf(write: SpendingWrite): string | null {
  switch (write.kind) {
    case 'record':
      return write.body.id
    case 'amend':
    case 'remove':
    case 'restore':
      return write.id
    default:
      return null
  }
}

function encode(write: SpendingWrite): Loose {
  switch (write.kind) {
    case 'record':
      return { kind: write.kind, body: spendingBodySchema.encode(write.body) }
    case 'amend':
      return { kind: write.kind, id: write.id, body: spendingAmendBodySchema.encode(write.body) }
    case 'category-add':
      return { kind: write.kind, body: spendingCategoryBodySchema.encode(write.body) }
    default:
      return { ...write }
  }
}

/** Through the bodies' own schemas, so a write the server would refuse never waits for a signal. */
function decode(raw: unknown): SpendingWrite | null {
  if (!isRecord(raw)) return null
  const { kind, id } = raw
  if (kind === 'record') {
    const body = spendingBodySchema.safeParse(raw.body)
    return body.success ? { kind, body: body.data } : null
  }
  if (kind === 'category-add') {
    const body = spendingCategoryBodySchema.safeParse(raw.body)
    return body.success ? { kind, body: body.data } : null
  }
  if (typeof id !== 'string' || !isIdentifier(id)) return null
  if (kind === 'amend') {
    const body = spendingAmendBodySchema.safeParse(raw.body)
    return body.success ? { kind, id, body: body.data } : null
  }
  if (
    kind === 'remove' ||
    kind === 'restore' ||
    kind === 'category-archive' ||
    kind === 'category-restore'
  )
    return { kind, id }
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

/** A broken entry is dropped alone: the ones around it are somebody's money. */
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

function recallRejected(key: string): RejectedSpendingWrite[] {
  return parsedList(key).flatMap((item: unknown) => {
    if (!isRecord(item) || typeof item.key !== 'string' || !isWireCode(item.code)) return []
    const write = decode(item.write)
    return write ? [{ key: item.key, write, code: item.code }] : []
  })
}

function amendOf(revision: number, fields: SpendingFields): SpendingAmendBody {
  return { revision, ...fields }
}

/**
 * The fields of a write, for a fold or for a record turned into an amendment. The account and
 * «списано» travel too (MOL-123, Р-4): left out of an amendment the server keeps the account it has
 * (Р-26 MOL-115), so a fold that dropped them sent the spending back onto its old account in silence.
 */
function fieldsOf(body: SpendingBody | SpendingAmendBody): SpendingFields {
  const { spentOn, amount, categoryId, note, place, accountId, debited } = body
  return {
    spentOn,
    amount,
    categoryId,
    ...(note === undefined ? {} : { note }),
    ...(place === undefined ? {} : { place }),
    ...(accountId === undefined ? {} : { accountId }),
    ...(debited === undefined ? {} : { debited }),
  }
}

/**
 * Runs `work` while no window is sending this owner's spendings — «Выйти» erases the queue under
 * it, as it does the trip's (MOL-57).
 */
export function whileSpendingsAreStill(owner: string, work: () => Promise<void>): Promise<void> {
  return exclusively(`${QUEUE_KEY}.${owner}`, work)
}

/**
 * Every write of «Деньги» goes through here, with a connection or without one (MOL-82): the sheet
 * closes at once and never learns which case it was in — the rules of the trip's queue (MOL-24).
 *
 * **Storage is the queue, not a copy of it**: every window reads it before each change and send,
 * takes out only the write it sent, and one window sends at a time. **A repeat is safe** — the
 * device names every spending and every category, so a write whose answer was lost meets itself.
 *
 * **The writes of one spending fold together** while they wait: an amendment of one not yet sent
 * rewrites its record, two amendments are one — the second would otherwise go over the revision
 * the first had already moved and come back 409 — and removing one not yet sent takes it out of
 * the queue, which «Вернуть» puts back. A write already on its way is never folded into: its
 * answer takes its key out.
 *
 * Nothing here adds anything up: the month on screen is the server's, and `pending` is what the
 * screen says about the rest. `landed` moves whenever the server has answered a write, which is
 * when the month is to be read again.
 */
export const useSpendingQueueStore = defineStore('spendingQueue', () => {
  const actor = useActorStore()
  const login = useLoginStore()

  let kept: Kept[] = []
  const pending = ref<SpendingWrite[]>([])
  const rejected = ref<RejectedSpendingWrite[]>([])
  /** How many writes the server has answered in this window — the screen reads the month again. */
  const landed = ref(0)
  /**
   * The categories this window wrote that have landed. A category leaves the queue on its answer,
   * and the list that names it is read again only after: in between it stood on no chip, and
   * «Сохранить трату» said «Выберите категорию» over the one just made and chosen. The lists take
   * these until the server's names them (`categoriesWith` skips one it holds).
   */
  const arrived = ref<Extract<SpendingWrite, { kind: 'category-add' }>[]>([])
  /**
   * The spendings whose removal has landed, and when. Out of the queue on its answer, a removal no
   * longer hides its row, while the month on screen is still the answer read before it: the row
   * came back for a moment, and its day shrank, grew and shrank again (MOL-151, adversarial А3).
   * The screen hides one until a month read after it; a removal taken back by «Вернуть» lets go.
   */
  const gone = ref<Landed[]>([])
  let ahead = false
  /** The key of the write a send is carrying right now: it is never folded into. */
  let inFlight: string | null = null

  function show(): void {
    pending.value = kept.map((item) => item.write)
  }

  function sync(id: string | null): void {
    if (!id || ahead) return
    kept = recallKept(`${QUEUE_KEY}.${id}`)
    rejected.value = recallRejected(`${REJECTED_KEY}.${id}`)
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
        })),
      ),
      (past) => past,
    )
    ahead = !queued || !refused
  }

  function load(id: string | null): void {
    ahead = false
    inFlight = null
    kept = []
    rejected.value = []
    arrived.value = []
    gone.value = id ? recallLanded(`${GONE_KEY}.${id}`) : []
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
    if (id && (event.key === `${QUEUE_KEY}.${id}` || event.key === `${REJECTED_KEY}.${id}`)) {
      sync(id)
      landed.value++
    }
    if (id && event.key === `${GONE_KEY}.${id}`) gone.value = recallLanded(event.key)
  })

  const retry = doublingRetry(() => void attempt())

  async function attempt(): Promise<void> {
    if (actor.state === 'error') await actor.retry()
    await flush()
  }

  let running: Promise<void> | null = null

  /** One run at a time, and only once the server has said who we are (MOL-56). */
  function flush(): Promise<void> {
    if (actor.state !== 'ready' || login.rechecking) {
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

  async function send(write: SpendingWrite): Promise<void> {
    switch (write.kind) {
      case 'record':
        await api.recordSpending(write.body)
        return
      case 'amend':
        await api.amendSpending(write.id, write.body)
        return
      case 'remove':
        await api.removeSpending(write.id)
        return
      case 'restore':
        await api.restoreSpending(write.id)
        return
      case 'category-add':
        await api.addSpendingCategory(write.body)
        return
      case 'category-archive':
        await api.archiveSpendingCategory(write.id)
        return
      case 'category-restore':
        await api.restoreSpendingCategory(write.id)
        return
    }
  }

  async function drain(owner: string): Promise<void> {
    for (;;) {
      if (actor.id !== owner) return
      sync(owner)
      const head = kept[0]
      if (!head) break

      // Nothing is tried while the browser knows there is no connection: a write made at the till
      // with no signal stays unmarked, so the next change still folds into it (round 2, Н1–Н3).
      // `online` brings the queue back (App.vue).
      if (!navigator.onLine) return

      let refusal: WireCode | null = null
      const tried = head.attempted === true
      // Marked before it leaves, on every shelf: another window must not fold into it or take it
      // out while its fate is unknown.
      if (!tried) {
        kept = kept.map((item) => (item.key === head.key ? { ...item, attempted: true } : item))
        persist(owner)
      }
      inFlight = head.key
      try {
        await send(head.write)
      } catch (error) {
        const known = error instanceof ApiError
        const code = known ? error.code : ERROR.INTERNAL
        if (!known || !error.answered || HOLDS.includes(code)) {
          // An answer that came and is not the API's — a portal's page — says the request never
          // reached the server (MOL-57, round 4, Ж1): its fate is known, and the mark goes.
          if (known && !error.answered && code !== ERROR.INTERNAL && !tried) unmark(owner, head.key)
          if (code !== ERROR.NO_ACTOR) retry.later()
          return
        }
        refusal = DONE_ENOUGH[head.write.kind]?.includes(code) ? null : code
      } finally {
        inFlight = null
      }
      if (actor.id !== owner) return

      sync(owner)
      const write = head.write
      kept = kept.filter((item) => item.key !== head.key)
      // A record the server already holds with other fields is this phone's own: its answer was
      // lost and the person amended it meanwhile, which folded the amendment into the record. It
      // was written at revision 1, so it goes on as an amendment over that — refused only if
      // someone moved it since (the exchanges' В-6, answered here rather than on screen).
      if (refusal === ERROR.CONFLICT && write.kind === 'record') {
        const fields = laterFields(write.body.id) ?? fieldsOf(write.body)
        kept = [
          { key: newKey(), write: { kind: 'amend', id: write.body.id, body: amendOf(1, fields) } },
          ...kept,
        ]
        refusal = null
      }
      // Refused, but the person has removed the spending since: nothing is left to fix, and a row
      // «Не принята» would bring back a spending they deleted (round 3, Р1). The removal behind it
      // goes on — 404 is done, and a spending an amendment was refused about is still removed.
      const about = spendingOf(write)
      if (refusal && about !== null && removedLater(about)) {
        laterFields(about)
        refusal = null
      }
      if (refusal) {
        console.warn(`[spending queue] ${write.kind} refused: ${refusal}`)
        rejected.value = [
          ...rejected.value,
          { key: newKey(), write: withLater(write), code: refusal },
        ]
      }
      if (!refusal && write.kind === 'category-add') arrived.value = [...arrived.value, write]
      if (!refusal && (write.kind === 'remove' || write.kind === 'restore'))
        gone.value = landedAgain(`${GONE_KEY}.${owner}`, write.id, write.kind === 'remove')
      persist(owner)
      landed.value++
    }
    retry.reset()
  }

  function unmark(owner: string, key: string): void {
    sync(owner)
    kept = kept.map((item) => (item.key === key ? { key: item.key, write: item.write } : item))
    persist(owner)
  }

  /**
   * The amendments waiting behind a write the server has just answered, taken out of the queue:
   * the fields of the last of them, or null. They were made over what that write would have made,
   * so once it is refused they have nothing to stand on. Sent on, a guessed revision went over
   * another device's amendment in silence, and one behind a refused record earned a stray 404
   * (round 2, Н1, Н3). Nothing behind the head can be on its way: one window sends, in order.
   */
  function laterFields(id: string): SpendingFields | null {
    const later = kept.filter((item) => item.write.kind === 'amend' && item.write.id === id)
    const last = later.at(-1)?.write
    if (last?.kind !== 'amend') return null
    kept = kept.filter((item) => !later.includes(item))
    return fieldsOf(last.body)
  }

  /** Whether the last of «Удалить» and «Вернуть» still waiting about the spending is a removal. */
  function removedLater(id: string): boolean {
    const last = kept
      .filter(
        (item) =>
          (item.write.kind === 'remove' || item.write.kind === 'restore') && item.write.id === id,
      )
      .at(-1)?.write
    return last?.kind === 'remove'
  }

  /** A refused record or amendment, carrying what the person typed last — one refusal to fix. */
  function withLater(write: SpendingWrite): SpendingWrite {
    if (write.kind === 'record') {
      const fields = laterFields(write.body.id)
      return fields ? { kind: 'record', body: { id: write.body.id, ...fields } } : write
    }
    if (write.kind === 'amend') {
      const fields = laterFields(write.id)
      return fields
        ? { kind: 'amend', id: write.id, body: amendOf(write.body.revision, fields) }
        : write
    }
    return write
  }

  function change(work: () => void): void {
    const id = actor.id
    sync(id)
    work()
    persist(id)
    void flush()
  }

  /** Neither on its way nor ever on its way: only such a write may be folded into or taken out. */
  const waiting = (item: Kept) => item.key !== inFlight && !item.attempted

  /** «Сохранить» a new spending. */
  function record(body: SpendingBody): void {
    change(() => {
      kept = [...kept, { key: newKey(), write: { kind: 'record', body } }]
    })
  }

  /**
   * «Сохранить» an amendment over `revision` — the version the screen showed. Folded into what
   * waits for the same spending, in its place and under a new key.
   */
  function amend(id: string, revision: number, fields: SpendingFields): void {
    change(() => {
      const at = kept.findIndex(
        (item) =>
          waiting(item) &&
          ((item.write.kind === 'record' && item.write.body.id === id) ||
            (item.write.kind === 'amend' && item.write.id === id)),
      )
      const earlier = at === -1 ? null : kept[at]?.write
      if (earlier?.kind === 'record') {
        kept = kept.map((item, index) =>
          index === at
            ? { key: newKey(), write: { kind: 'record', body: { id, ...fields } } }
            : item,
        )
        return
      }
      if (earlier?.kind === 'amend') {
        const body = amendOf(earlier.body.revision, fields)
        kept = kept.map((item, index) =>
          index === at ? { key: newKey(), write: { kind: 'amend', id, body } } : item,
        )
        return
      }
      // One that may have landed moves the revision by one: a record makes the first, an
      // amendment the next. The last of them counts — a queue may hold several.
      const moving = kept
        .filter((item) => !waiting(item) && spendingOf(item.write) === id)
        .at(-1)?.write
      const base =
        moving?.kind === 'record'
          ? 1
          : moving?.kind === 'amend'
            ? moving.body.revision + 1
            : revision
      kept = [...kept, { key: newKey(), write: { kind: 'amend', id, body: amendOf(base, fields) } }]
    })
  }

  /**
   * «Удалить трату», without a question (В-4). A spending nobody has begun to send never reached
   * the server, so it is taken out of the queue with the amendments behind it, and «Вернуть» puts
   * them back (review У-1). Once a send of its record has begun it may have landed with its answer
   * lost, so the removal goes to the server, and 404 on it is done (adversarial А). A refusal about
   * the spending goes with it — there is nothing left to fix.
   */
  function remove(id: string): SpendingUndo {
    let undo: SpendingUndo = { id }
    change(() => {
      rejected.value = rejected.value.filter((item) => spendingOf(item.write) !== id)
      const own = kept.filter(
        (item) =>
          (item.write.kind === 'record' || item.write.kind === 'amend') &&
          spendingOf(item.write) === id,
      )
      if (own.some((item) => item.write.kind === 'record') && own.every(waiting)) {
        kept = kept.filter((item) => !own.includes(item))
        undo = { id, writes: own.map((item) => item.write) }
        return
      }
      if (
        kept.some((item) => waiting(item) && item.write.kind === 'remove' && item.write.id === id)
      )
        return
      kept = [...kept, { key: newKey(), write: { kind: 'remove', id } }]
    })
    return undo
  }

  /**
   * «Вернуть»: what was taken out put back; else the removal taken back while it still waits, or
   * the spending brought back by the server once the removal may have left — never written anew,
   * which a marked spending answers with 409 (MOL-73, Д6).
   */
  function restore(undo: SpendingUndo): void {
    change(() => {
      if (undo.writes) {
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
    })
  }

  /** «Добавить категорию», named by the device (В-4). */
  function addCategory(body: SpendingCategoryBody): void {
    change(() => {
      kept = [...kept, { key: newKey(), write: { kind: 'category-add', body } }]
    })
  }

  /** «Убрать» or «Вернуть» a category: the opposite still waiting cancels out. */
  function archiveCategory(id: string, archived: boolean): void {
    const kind = archived ? 'category-archive' : 'category-restore'
    const opposite = archived ? 'category-restore' : 'category-archive'
    change(() => {
      const at = kept.findIndex(
        (item) => waiting(item) && item.write.kind === opposite && item.write.id === id,
      )
      kept =
        at === -1
          ? [...kept, { key: newKey(), write: { kind, id } }]
          : kept.filter((_, index) => index !== at)
    })
  }

  /** «Убрать» a refusal from the screen: the write is gone for good. */
  function dismiss(item: RejectedSpendingWrite): void {
    const id = actor.id
    sync(id)
    rejected.value = rejected.value.filter((entry) => entry.key !== item.key)
    persist(id)
  }

  return {
    pending,
    rejected,
    landed,
    arrived,
    gone,
    flush,
    record,
    amend,
    remove,
    restore,
    addCategory,
    archiveCategory,
    dismiss,
  }
})
