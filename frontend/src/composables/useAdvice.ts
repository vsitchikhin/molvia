import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { z } from 'zod'
import type { ComputedRef } from 'vue'
import { adviceResponseSchema, geographyKey, verdictFields } from '@molvia/model'
import type { AdviceFound, AdviceResponse, AdviceRow, AdviceScope } from '@molvia/model'
import { api } from '@/api'
import type { CheapRow, NeverRow, TakeRow } from '@/components/adviceRow'
import type { SavedVerdict } from '@/components/rating'
import { useReconnect } from '@/composables/useReconnect'
import { useActorStore } from '@/stores/actor'
import { forget, read, write, writeEverywhere } from '@/stores/storage'
import { forgetOwnPrices } from '@/stores/ownPrices'
import { reportFailure } from '@/failures'
import { newId } from '@/ids'

/** `idle` — no identity, so there is nobody to advise. */
export type AdvicePhase = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'offline'

/**
 * The rows of one answer, split by verdict — the shape the screen draws. Each group carries
 * its own kind of row, so a card that prints a price cannot be handed a row that has none:
 * the product's rule is held by the type checker here too, not only on the wire.
 */
export interface AdviceGroups {
  readonly take: TakeRow[]
  readonly if_cheap: CheapRow[]
  readonly never: NeverRow[]
}

export interface Advice {
  readonly phase: ComputedRef<AdvicePhase>
  /** Whose figures the rows carry. The screen cannot work it out, and must say it in words. */
  readonly scope: ComputedRef<AdviceScope | null>
  readonly groups: ComputedRef<AdviceGroups>
  /** How many rows are on the screen, and how many there are in all — «Показаны 200 из 340». */
  readonly shown: ComputedRef<number>
  readonly total: ComputedRef<number>
  /**
   * The rows come from the phone rather than from an answer of this session, and why: a
   * request still on its way, no connection, or a server that broke.
   */
  readonly stale: ComputedRef<Stale | null>
  readonly cityReloading: ComputedRef<string | null>
  readonly otherCity: ComputedRef<{ oldCity: string; city: string } | null>
  readonly fetchedAt: ComputedRef<Date | null>
  /** How many answers have failed: a retry that failed the same way is said again (MOL-181, C1). */
  readonly attempt: ComputedRef<number>
  /** The answer on screen, remembered or fresh: the search reads it with no connection (MOL-128). */
  readonly answer: ComputedRef<AdviceResponse | null>
  /**
   * A verdict written from the sheet: the server's answer to the write, `null` once withdrawn, and
   * what was on the screen then — before the list is asked for again (MOL-202, А1).
   */
  wrote(itemId: string, verdict: SavedVerdict | null, shown: readonly object[]): void
  /** What a write here made of the verdict behind a row, while the row is older than the write. */
  writtenOver(shown: AdviceRow | AdviceFound): { readonly verdict: SavedVerdict | null } | null
  retry(): Promise<void>
}

/** Why the list on the screen is not an answer of this session (MOL-32, А4). */
export type Stale = 'loading' | 'offline' | 'error'

/**
 * Whatever is written here is read back by `adviceResponseSchema`, which is strict: a change
 * in the shape of the answer empties the memory of every phone that already had one, and the
 * first walk to the shop without a connection after an update shows nothing (adversarial А1).
 * Accepted knowingly — 0.1 is not released, and a lenient read would mean carrying «this
 * answer does not know its own city» through three comparisons below.
 */
const KEY = 'molvia.advice'

interface Remembered {
  readonly answer: AdviceResponse
  readonly fetchedAt: Date
}

function recall(key: string): Remembered | null {
  const raw = read(key)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { answer?: unknown; fetchedAt?: unknown }
    const answer = adviceResponseSchema.safeParse(parsed.answer)
    const fetchedAt =
      typeof parsed.fetchedAt === 'string' ? new Date(parsed.fetchedAt) : new Date(Number.NaN)
    if (!answer.success || Number.isNaN(fetchedAt.getTime())) return null
    return { answer: answer.data, fetchedAt }
  } catch {
    return null
  }
}

function split(rows: readonly AdviceRow[]): AdviceGroups {
  const take: TakeRow[] = []
  const if_cheap: CheapRow[] = []
  const never: NeverRow[] = []
  // No sorting: the server orders by rating down, and the levels are decided by that same
  // printed tenth, so the three groups already lie in the answer one after another (Р-22).
  for (const row of rows) {
    if (row.level === 'take') take.push(row)
    else if (row.level === 'if_cheap') if_cheap.push(row)
    else never.push(row)
  }
  return { take, if_cheap, never }
}

/**
 * «Тут дешевле» remembered for no signal must not outlive a «не брать нигде» given anywhere — in the
 * bot's reminder too, which never speaks to the phone (MOL-92, adversarial Б). The hint reads one's
 * own verdicts (adversarial Д): in the own mode the list's levels are those, and with access they are
 * an average of three — so the person's own are asked for (Б′), and a town's «1» over one's own «5»
 * lets nothing go (review №6). A failure costs only the memory's freshness.
 */
function forgetOwnNever(owner: string, fresh: AdviceResponse): void {
  if (fresh.scope === 'own') {
    const never = fresh.rows.filter((row) => row.level === 'never').map((row) => row.itemId)
    forgetOwnPrices(owner, never, { rated: false })
    return
  }
  api
    .ownNever()
    .then(({ itemIds }) => {
      forgetOwnPrices(owner, itemIds, { rated: false })
    })
    .catch(() => undefined)
}

/**
 * The verdicts written from «Что брать» that no answer of the list has caught up with yet, by item:
 * the server's answer to the write and when it was made (MOL-202, adversarial А1, Б1, В1).
 *
 * The rows stay as the answer before a save had them until an answer asked after it comes — and it
 * may fail, be on its way, or never come to this page: a step to «Покупки» and back mounts a new
 * screen, and a reload — iOS putting the app away, «Обновить» — a new page, both over the memory
 * written before the save. A sheet opened on such a row said «Ваша оценка: 1» over the 5 just saved,
 * and refused the 1 as «Ничего не изменилось». So the write is kept on the shelf beside that memory,
 * `molvia.advice-written.<owner>` — swept with the owner's other drawers by «Выйти» and erasure — and
 * let go once an answer asked after it is taken. While it is there, every row of the list is older
 * than it — a refresh already in the air when it was made lands with the old figures and lets nothing
 * go — and opens the sheet on what was written. A newer row is the server's word again.
 *
 * «After» is told without a clock: the request that answers a save goes out in the very millisecond
 * the write is kept. The requests of the list are numbered across the screens of a page, and a write
 * keeps the page and the last number asked before it; a request of another page — after a reload —
 * is after it by its nature.
 */
const WRITTEN = 'molvia.advice-written'

/** This page among the ones the phone has loaded: a reload is another. */
const PAGE = newId()

/** The requests of the list, numbered across the screens of this page. */
let requests = 0

/** The newest answer the phone's memory holds, by owner: one landing later and older goes unwritten. */
const rememberedUpTo = new Map<string, number>()

const writtenSchema = z.record(
  z.string(),
  z.object({
    verdict: z
      .object({ score: verdictFields.shape.score, review: verdictFields.shape.review })
      .nullable(),
    page: z.string(),
    after: z.number(),
  }),
)
type Written = z.output<typeof writtenSchema>

/**
 * The writes as this page last set them, by owner — read before the shelf (MOL-202, adversarial Г1,
 * Г2). A shelf blocked outright keeps nothing, and one that refused a write for its quota still
 * answers with what it held; the page knows what it wrote either way. The shelf is for the next page.
 */
const pageWritten = new Map<string, Written>()

/** A fresh page, as a reload makes one: for the tests, which share one module between them. */
export function forgetPageWrites(): void {
  pageWritten.clear()
  rememberedUpTo.clear()
}

function readWritten(owner: string): Written {
  const kept = pageWritten.get(owner)
  if (kept) return kept
  try {
    const parsed = writtenSchema.safeParse(JSON.parse(read(`${WRITTEN}.${owner}`) ?? '{}'))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

function writeWritten(owner: string, entries: Written): void {
  pageWritten.set(owner, entries)
  // Every shelf or none: a shelf that refuses loses its past rather than answer the next page with it.
  if (Object.keys(entries).length === 0) forget(`${WRITTEN}.${owner}`)
  // Kept on no shelf the next page will have — `localStorage` full, `sessionStorage` gone with the
  // app — the write cannot stand over the list remembered before it there, so the list goes too:
  // no list offline is the truth, the score from before the write is not (adversarial Д2).
  else if (!writeEverywhere(`${WRITTEN}.${owner}`, JSON.stringify(entries)))
    forget(`${KEY}.${owner}`)
}

/**
 * The rows found by the search when a verdict was written, by owner and item. Not on the shelf: the
 * search is asked again on a save, and drops the answer of any request older than its last, so only
 * the rows it showed then, dimmed until the next answer, are older than the write.
 */
const foundAtWrite = new Map<string, WeakSet<object>>()

/**
 * «Что брать» as this phone sees it (MOL-32): the server's answer, and the last one it gave.
 *
 * The memory is not about speed. Offline the screen has to name the age of what it shows —
 * «список на вчера в 21:40» is what a person judges by, «данные могут быть неактуальны» is
 * not — and it can name it only if it kept the answer. Verdicts are worked out on the server
 * and there is nothing on the phone to compute them from, so the choice is the remembered
 * list or an empty screen at the shelf (В-5).
 *
 * A remembered list outranks a failure: while there is something to show, offline is a strip
 * above the rows, not a screen of its own (Р-5).
 */
export function useAdvice(): Advice {
  const actor = useActorStore()

  /** Whose answer is held here. Nothing is read or written under anyone else's id. */
  const owner = ref<string | null>(null)
  const remembered = ref<Remembered | null>(null)
  const failure = ref<'offline' | 'error' | null>(null)
  const failures = ref(0)
  /** Whether what is shown came from an answer of this session, rather than from the phone. */
  const confirmed = ref(false)

  const cityChanged = ref(false)
  const location = computed(() => (actor.settings ? geographyKey(actor.settings) : null))

  function adopt(id: string | null): void {
    owner.value = id
    const cached = id ? recall(`${KEY}.${id}`) : null
    cityChanged.value =
      !!cached && !!location.value && geographyKey(cached.answer.geography) !== location.value
    // Without a settings snapshot the city is unknown — which does not make yesterday's prices
    // untrue, and the strip above them names their age to the minute (adversarial А2). The
    // first cold start after an update is exactly that case, and it is at the shelf.
    remembered.value = cached && (!cityChanged.value || !navigator.onLine) ? cached : null
    // Decided after the failure, never before the request (MOL-19, A1).
    failure.value = null
    confirmed.value = false
  }

  function remember(): void {
    if (!owner.value || !remembered.value) return
    const { answer, fetchedAt } = remembered.value
    write(
      `${KEY}.${owner.value}`,
      JSON.stringify({
        answer: adviceResponseSchema.encode(answer),
        fetchedAt: fetchedAt.toISOString(),
      }),
    )
  }

  const rows = computed<AdviceRow[]>(() => remembered.value?.answer.rows ?? [])

  const phase = computed<AdvicePhase>(() => {
    // No identity, nothing to ask for: `IdentityNotice` above the content says why.
    if (!actor.id) return 'idle'
    if (remembered.value) return rows.value.length > 0 ? 'ready' : 'empty'
    if (failure.value) return failure.value
    return 'loading'
  })

  /**
   * One request at a time, and only the newest may be written down.
   *
   * `running` used to be an identifier, and a second call for the same person simply returned
   * — but `retry` is this same function, so a save that happened while a refresh was in the
   * air updated nothing and the screen kept the figures the older answer brought (А3). And
   * two changes of identity, A → B → A, slipped two requests for A past that guard: the
   * slower one landed last and overwrote the fresher list, on the screen and on the phone
   * alike (А6). So an ask that arrives while a request is in the air is remembered rather
   * than dropped, and every answer carries the number of the request that asked for it.
   */
  let running: object | null = null
  /** Whether the screen is still here: one gone may take an answer, never let a write go. */
  let alive = true
  let latest = 0
  /** How many times a fresh list has been asked for; the loop below serves the last ask. */
  let asks = 0

  async function ask(id: string): Promise<void> {
    const mine = ++requests
    latest = mine
    const where = location.value
    try {
      const fresh = await api.advice()
      if (owner.value !== id || mine !== latest || location.value !== where) return
      // The server names the geography it actually used; a second device may have moved it.
      if (location.value && geographyKey(fresh.geography) !== location.value) {
        const loaded = await api.me()
        if (owner.value !== id || mine !== latest || loaded.id !== id) return
        actor.apply(loaded)
        // Only a moved `location` fires the watcher and asks again. It does not move when the
        // other device put the city back, or when `apply` refuses a row older than the one
        // held — and then returning here left the screen on a skeleton that has no «Повторить»
        // and no way out but the server changing its mind (adversarial А3). Which city the
        // answer is about is the server's to know, so the answer is taken as it is.
        if (location.value !== where) return
      }
      remembered.value = { answer: fresh, fetchedAt: new Date() }
      failure.value = null
      confirmed.value = true
      // A screen gone still takes its answer into the phone's memory (adversarial Д3) — the newest
      // of the page only: one asked before a step away and back may land after the next screen's.
      if (mine > (rememberedUpTo.get(id) ?? 0)) {
        rememberedUpTo.set(id, mine)
        remember()
      }
      // Asked after a write, the answer has it: the write is let go (MOL-202, В1) — by a screen
      // still here only: the one that is may still show the rows from before it (review №5).
      if (alive) {
        const entries = Object.entries(readWritten(id))
        const waiting = entries.filter(([, entry]) => entry.page === PAGE && entry.after >= mine)
        if (waiting.length < entries.length) writeWritten(id, Object.fromEntries(waiting))
      }
      forgetOwnNever(id, fresh)
    } catch (error) {
      reportFailure(error, 'screen')
      if (owner.value !== id || mine !== latest || location.value !== where) return
      // Decided after the failure, never narrowed from a check before the request: a
      // connection lost while the answer was on its way is the commonest break at a shelf,
      // and it is not the server's fault and never red.
      failure.value = navigator.onLine ? 'error' : 'offline'
      failures.value += 1
      if (!navigator.onLine && !remembered.value) {
        remembered.value = recall(`${KEY}.${id}`)
      }
    }
  }

  async function load(): Promise<void> {
    if (!actor.id) return
    if (
      navigator.onLine &&
      remembered.value &&
      location.value &&
      geographyKey(remembered.value.answer.geography) !== location.value
    ) {
      remembered.value = null
      failure.value = null
      confirmed.value = false
    }
    asks += 1
    if (running) return
    const token = {}
    running = token
    try {
      let served = 0
      while (served !== asks) {
        served = asks
        // Read afresh every round: the identity may have changed while the last answer was on
        // its way, and the next request belongs to whoever the person is now.
        const id = actor.id
        if (!id) break
        await ask(id)
        if (running !== token) break
      }
    } finally {
      if (running === token) running = null
    }
  }

  adopt(actor.id)
  watch(
    () => [actor.id, location.value],
    () => {
      latest = ++requests
      running = null
      adopt(actor.id)
      void load()
    },
  )
  onMounted(() => void load())
  // A screen gone asks nothing more, and lets no write go (MOL-202, review №5): its answer landing
  // after a step away and back let one go while the new screen still showed the rows from before it.
  onUnmounted(() => {
    alive = false
    running = null
  })
  useReconnect(() => void load())

  return {
    phase,
    scope: computed(() => remembered.value?.answer.scope ?? null),
    groups: computed(() => split(rows.value)),
    shown: computed(() => rows.value.length),
    total: computed(() => remembered.value?.answer.total ?? 0),
    /**
     * Nothing to say when the list came from this session's own answer. Otherwise the reason
     * it did not: a request still in the air is one of them — the same yesterday's prices
     * looked freshly loaded until the failure arrived (А4).
     */
    stale: computed<Stale | null>(() => {
      if (remembered.value === null || confirmed.value) return null
      return failure.value ?? 'loading'
    }),
    cityReloading: computed(() =>
      cityChanged.value && phase.value === 'loading' ? (actor.settings?.city ?? null) : null,
    ),
    otherCity: computed(() =>
      remembered.value &&
      actor.settings &&
      geographyKey(remembered.value.answer.geography) !== location.value
        ? { oldCity: remembered.value.answer.geography.city, city: actor.settings.city }
        : null,
    ),
    fetchedAt: computed(() => remembered.value?.fetchedAt ?? null),
    attempt: computed(() => failures.value),
    answer: computed(() => remembered.value?.answer ?? null),
    wrote(itemId, verdict, shown) {
      const id = owner.value
      if (!id) return
      writeWritten(id, { ...readWritten(id), [itemId]: { verdict, page: PAGE, after: requests } })
      foundAtWrite.set(`${id} ${itemId}`, new WeakSet(shown))
    },
    writtenOver(shown) {
      const id = owner.value
      const entry = id ? readWritten(id)[shown.itemId] : undefined
      if (!id || !entry) return null
      const fromList = rows.value.some((row) => row === shown)
      return fromList || foundAtWrite.get(`${id} ${shown.itemId}`)?.has(shown) ? entry : null
    },
    retry: load,
  }
}
