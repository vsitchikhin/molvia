import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR, ISSUE } from '@molvia/model'
import type { ActorView } from '@molvia/model'
import { api } from '@/api'
import { forget, read, write } from '@/stores/storage'
import { LOGIN_KEY } from '@/stores/identity'
import { useActorStore } from '@/stores/actor'
import { reportFailure } from '@/failures'

/**
 * The login as the device remembers it — and the device remembers exactly three things.
 *
 * **The started request**, because the way in leads out of the app: on iOS a `t.me` link opens
 * Telegram, and the PWA behind it may be unloaded by the time the person comes back. Without
 * this the confirmation they gave would have nowhere to arrive. What is kept is the public
 * identifier and the link — **never the secret**: that lives in `__Host-molvia_login`, where no
 * script can read it, and putting it here would be MOL-8's mistake all over again.
 *
 * **The owner this person has said is theirs**, because a session can arrive for an account that
 * is not (MOL-55, round 3): whoever sees the link within its five minutes can confirm it with
 * their own Telegram, and the browser that started the login collects *that* account.
 *
 * **It is written down the right way round, and that is the whole of the second fix**
 * (adversarial А1 и А4). The first version kept the opposite — «somebody is unconfirmed» — a
 * flag set when the script happened to see the answer that collected a session, and cleared by
 * anything that looked like a signed-out state. Both halves were wrong about the world:
 *
 * - The browser stores the cookie from the *headers* of the poll's answer. A script that never
 *   saw that answer — the app was restarted, «Начать заново» was pressed a moment earlier —
 *   left no flag behind, and the door opened on a session nobody had been asked about.
 * - `error.no_actor` says there was no session **when that request left**, and nothing about
 *   now. An answer still in flight from before the login cleared the flag, and the next
 *   `me()` walked in.
 *
 * Kept as «claimed», the question cannot be missed: whoever the server says we are is compared
 * with whoever the person approved, and anything else is a question — however the session got
 * here.
 *
 * **When this device last began a login that nobody has come in by since** (`tried`, MOL-68),
 * because the funnel of the gates asks how many who began got in, and «Начать заново» or a return
 * after the link ran out is the same person trying again, not a loss and a newcomer. The next start
 * within a day says so — `again=1`. Set when the server took a start, or may have (an answer lost
 * on the way back); taken away by any session collected here — whosever, since the attempt ended
 * in one — by «Да, это я» and by «Выйти». Not a secret and not about anyone: all it can change is
 * our own count.
 */
const KEY = LOGIN_KEY

/** How often a login that is waiting asks whether it has been confirmed. */
export const POLL_INTERVAL_MS = 3000

export type LoginFailure = 'unavailable' | 'rate_limited' | 'disabled' | 'error' | 'offline'

export type LoginPhase = 'loading' | 'offer' | 'waiting' | 'welcome' | LoginFailure

interface Request {
  readonly id: string
  readonly url: string
}

interface Kept {
  readonly request?: Request
  readonly claimed?: string
  /**
   * When this device last began a login nobody has come in by since, in the device's
   * milliseconds (MOL-68) — see the header. Of the device, not of a window: set by whichever
   * window's start the server took, taken away by whichever window's session arrives.
   */
  readonly tried?: number
}

/**
 * How long a start counts as the same sitting (review Е): a day. Without a term, a person who gave
 * up in October and came back in December was «again» in December's window — they got in, and
 * began nowhere — and October's loss stood alone. Each window now holds its own: a loss where it
 * happened, a beginning where it came back.
 */
const TRIED_TERM_MS = 24 * 60 * 60 * 1000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A link is opened, so what comes back off the shelf is checked before it is: storage is the
 * one input here that nothing on the wire validated. `loginStartedCodec` holds the same shape
 * on the way in, and this holds it on the way back out.
 */
function isRequest(value: unknown): value is Request {
  if (typeof value !== 'object' || value === null) return false
  const { id, url } = value as Record<string, unknown>
  if (typeof id !== 'string' || !UUID.test(id) || typeof url !== 'string') return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname === 't.me'
  } catch {
    return false
  }
}

function recall(): Kept {
  const raw = read(KEY)
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const { request, claimed, tried } = parsed as Record<string, unknown>
    return {
      ...(isRequest(request) ? { request } : {}),
      ...(typeof claimed === 'string' && UUID.test(claimed) ? { claimed } : {}),
      ...(typeof tried === 'number' && Number.isFinite(tried) ? { tried } : {}),
    }
  } catch {
    return {}
  }
}

export const useLoginStore = defineStore('login', () => {
  const actor = useActorStore()
  const kept = recall()
  const request = ref<Request | null>(kept.request ?? null)
  const claimed = ref<string | null>(kept.claimed ?? null)
  const failure = ref<LoginFailure | null>(null)
  const connected = ref(navigator.onLine)
  /** True while `POST /auth/login` is in flight, so the tap has a visible consequence at once. */
  const starting = ref(false)
  /**
   * True while another window's login is being caught up with — see the `storage` listener.
   *
   * Read by the queues as well: until that `me()` answers, this window's idea of who it is comes
   * from before the neighbour's login, and a write of its own would leave under a session that
   * may not be this person's (self-review, round 4's note).
   */
  const rechecking = ref(false)
  /**
   * The owner the person has just said is not theirs. In memory only: it exists to keep the
   * screen on the new attempt instead of asking the same question again, and a relaunch may
   * ask again — the door is shut either way.
   */
  const refusedOwner = ref<string | null>(null)
  /** One request in flight at a time: the interval and a tap must not poll twice over. */
  let polling = false
  /** The poll in flight, so «Это не я» can wait for its answer before it decides anything. */
  let polled: Promise<void> | null = null
  /**
   * True while «Это не я» ends the stranger's session (MOL-57, adversarial Г1). A poll that went
   * out meanwhile could collect this person's own session, and if its answer arrived before the
   * way out's, the way out's `Max-Age=0` — addressed to the cookie's name, not to a token — would
   * put the fresh session out of the jar. Held, the poll leaves after the way out has answered.
   */
  let holding = false

  window.addEventListener('online', () => {
    connected.value = true
  })
  window.addEventListener('offline', () => {
    connected.value = false
  })

  /**
   * **A window writes its own request and never another window's** (adversarial А3). The key is
   * shared, so a window whose link died used to call `forget` over a live request its neighbour
   * had just started — and a neighbour that iOS had unloaded then came back to «Войти через
   * Telegram» with a confirmation on its way to nobody. Starting a login still replaces what is
   * stored, because a new start replaces the secret and kills whatever was there; only removal
   * and rewriting are checked against ownership.
   */
  /** `tried`: the moment to keep, `null` to take the mark away; left out, what is stored stays. */
  function store(held: Request | null, tried: number | null = recall().tried ?? null): void {
    if (!held && !claimed.value && tried === null) {
      forget(KEY)
      return
    }
    write(
      KEY,
      JSON.stringify({
        ...(held ? { request: held } : {}),
        ...(claimed.value ? { claimed: claimed.value } : {}),
        ...(tried === null ? {} : { tried }),
      }),
    )
  }

  /**
   * Пишет признанного владельца, **не касаясь запроса**: тот мог начать соседнее окно, и
   * окно без своего запроса записывало `{claimed}` поверх чужого — ровно то, что закрывало
   * правило А3 (саморевью Р3-2).
   */
  function keepClaimOnly(tried?: number | null): void {
    store(recall().request ?? null, tried)
  }

  /** Who the server last said this browser is, or — with nothing to ask — the drawer's name. */
  const known = computed(() => actor.actor?.id ?? actor.id)

  /**
   * **The door stays shut until the person has said the account is theirs** — and it is shut by
   * comparing, not by remembering an event. A session this browser holds without an answer is a
   * session somebody else may have confirmed (MOL-55, round 3), whether the app noticed it
   * arrive or not.
   */
  const blocked = computed(
    () => rechecking.value || (known.value !== null && known.value !== claimed.value),
  )

  /**
   * **Дверь**, и она одна на всё приложение: `App.vue` рисует либо экран входа, либо маршрут.
   *
   * Открыта, когда сервер сказал, кто мы, и человек этого владельца признал. «Сессии нет» —
   * такой же ответ, и он закрывает дверь, чей бы ящик ни лежал на устройстве. Пока ответа нет
   * вовсе — на запуске, в офлайне, за молчащим API — решает **ящик**: с ним приложение
   * показывается своим же скелетом, как и до этой задачи, а без него показывать нечего вовсе,
   * ни очереди, ни запомненных ответов. Довод решения Q5 тут ничем не отличается от случая,
   * когда сети нет: портал магазина отвечает `onLine === true`, и правило, написанное про
   * `navigator.onLine`, мимо него проходило (адверсариальный А5).
   *
   * Держать дверь закрытой **всё время загрузки** было бы хуже, чем кажется: на каждом запуске
   * с живой сессией человек видел бы мелькнувший «Вход» — и поймал это не глаз, а сквозной тест.
   */
  const closed = computed(() => {
    if (blocked.value) return true
    if (actor.state === 'ready') return false
    // «Сессии нет» — это ответ, а не незнание: ящик на устройстве его не отменяет.
    if (actor.state === 'signed-out') return true
    return actor.id === null
  })

  const phase = computed<LoginPhase>(() => {
    if (actor.state === 'idle' || actor.state === 'loading' || rechecking.value) return 'loading'
    if (failure.value) return failure.value
    // The account in hand is asked about before the attempt that is still waiting: a session may
    // well have arrived while the screen was showing «ждём» — that is what А4 is (the answer that
    // carried it never reached the script). «Это не я» is the one case where the new attempt
    // wins, and it says so by naming the owner it has just refused.
    if (actor.state === 'ready' && blocked.value && known.value !== refusedOwner.value)
      return 'welcome'
    if (starting.value || request.value) return 'waiting'
    // Not a skeleton: an identity that could not be checked is «no connection» or «try again»,
    // and a screen without all four of its states is what MOL-19 exists to prevent.
    if (actor.state === 'offline' || !connected.value) return 'offline'
    if (actor.state === 'error') return 'error'
    return 'offer'
  })

  /**
   * **What another window did to the login is this window's business too** (self-review С-1,
   * adversarial А2, review Р2-1). Two windows share one cookie jar, so a session collected in
   * one is the session the other carries — and a window that was already open would otherwise
   * keep showing the app, and the question, as the owner it believed in a minute ago.
   *
   * So the record is re-read **and the identity is asked for again**: the door is shut for the
   * length of that question, because until it is answered this window does not know whose
   * session it is holding.
   */
  window.addEventListener('storage', (event) => {
    if (event.key !== KEY) return
    const now = recall()
    claimed.value = now.claimed ?? null
    void catchUp()
  })

  async function catchUp(): Promise<void> {
    rechecking.value = true
    try {
      await actor.verify()
    } finally {
      rechecking.value = false
    }
  }

  /**
   * Telegram is opened by the tap, and the link stays on the screen regardless: a popup opened
   * after an `await` is blocked silently by iOS Safari often enough that the link is the way in,
   * not the fallback.
   */
  function open(url: string): void {
    window.open(url, '_blank', 'noopener')
  }

  /**
   * Whether a failed start may still have made a request: when nothing answered at all — a
   * dropped connection, a deadline, a bare 5xx — or when our `201` came and its body did not.
   * Whatever else answered made none: the API's own refusal (its transaction rolled back or never
   * began), and a captive portal's page, which means the request never reached us — with `200`
   * that page reads as a reply off the contract (review В1), and only the status tells it from ours.
   *
   * The prices, named. A portal answering `511`, a bare 5xx, marks one. And a break is ambiguous:
   * a start that never left, on a phone with bars and no internet, fails the way one whose answer
   * was lost does, and is marked too (round 4, Г1) — settled towards a repeat, away from the line,
   * for В-1's reason: a retry read as a loss pushes towards the dearer decision, a second way in.
   * Such a person who never gets in is in neither «began» nor «lost».
   */
  function mayHaveStarted(error: unknown): boolean {
    if (!(error instanceof ApiError)) return true
    // `201` is the API saying it wrote the request — no portal says it — and the body was lost on
    // its way (review Т1): a reply cut off mid-flight reads as one off the contract.
    if (error.code === ISSUE.RESPONSE_INVALID && error.status === 201) return true
    return !error.answered && error.code === ERROR.INTERNAL
  }

  function refused(error: unknown): LoginFailure {
    reportFailure(error, 'screen')
    if (error instanceof ApiError) {
      if (error.code === ERROR.LOGIN_RATE_LIMITED) return 'rate_limited'
      if (error.code === ERROR.LOGIN_DISABLED) return 'disabled'
      if (error.code === ERROR.LOGIN_UNAVAILABLE) return 'unavailable'
    }
    // Read after the failure, never before it: a connection that drops while the answer is on
    // its way is the commonest break there is, and drawing it red was MOL-19's first bug.
    return navigator.onLine ? 'error' : 'offline'
  }

  /**
   * «Войти через Telegram». One tap is one request, and nothing starts a login by itself: the
   * quota is thirty starts a minute **across the whole database**, so an app that started one
   * every time the screen appeared would close the door for everybody.
   */
  async function begin(): Promise<void> {
    if (request.value || starting.value) return
    failure.value = null
    starting.value = true
    const tried = recall().tried
    // Not before the mark (round 2, Р3): a clock that ran ahead and came back left a mark from
    // the future, and «less than a day» held for as long as that future lasted.
    const since = tried === undefined ? Number.NaN : Date.now() - tried
    const again = since >= 0 && since < TRIED_TERM_MS
    // Whether the start could leave at all, read before it does (round 2, Р1): after the failure
    // `onLine` says whether there is a connection now, and an answer lost with the connection is
    // the commonest break there is — the start arrived, its answer did not.
    const leaving = navigator.onLine
    try {
      const started = await api.startLogin({ again })
      request.value = { id: started.id, url: started.url }
      store(request.value, Date.now())
      open(started.url)
    } catch (error) {
      failure.value = refused(error)
      // Marked only when the server took the start, or may have: a start that never arrived made
      // no request, and the next one — the first the server sees — would leave as a repeat and be
      // nobody's beginning. But an answer lost on its way back is not «never arrived» (review Д):
      // the request and its count are there, the cookie is not, and unmarked the retry made one
      // person who got in a loss and a newcomer — at a shelf with a weak signal, which is where
      // the product is used, and where the phone goes offline with the answer (round 2, Р1).
      if (leaving && mayHaveStarted(error)) keepClaimOnly(Date.now())
    } finally {
      starting.value = false
    }
  }

  /**
   * Вход швом разработки: в прод-сборке его нет вовсе, а здесь он такой же исход, как и
   * настоящий вход, — и провал остаётся на этом экране, а не открывает приложение с плашкой.
   *
   * Вопроса «ваш ли это аккаунт» он не задаёт и задавать не должен: спрашивают ради чужого
   * подтверждения по утёкшей ссылке, а здесь человек входит сам, и никакого Telegram в этом нет.
   */
  async function devSignIn(): Promise<void> {
    failure.value = null
    const view = await actor.signIn()
    if (!view) {
      // failure reported where it failed: none — the seam of development, no build carries it (MOL-144).
      failure.value = navigator.onLine ? 'error' : 'offline'
      return
    }
    claim(view.id)
  }

  /** «Открыть Telegram» again — the same link, never a second request (see `begin`). */
  function again(): void {
    if (request.value) open(request.value.url)
  }

  /** «Начать заново»: the previous request is abandoned, and its secret is about to be replaced. */
  async function restart(): Promise<void> {
    drop()
    return begin()
  }

  /** Takes this window's request off the device, leaving a neighbour's alone. */
  function drop(tried?: number | null): void {
    const previous = request.value
    request.value = null
    const stored = recall().request ?? null
    store(stored?.id === previous?.id ? null : stored, tried)
  }

  /**
   * Asks whether the request has been confirmed. Called on a timer while the screen is shown,
   * on coming back into view and on `online` — the return from Telegram is the moment that
   * matters, and on iOS it arrives as a visibility change rather than as anything else.
   *
   * **The end of the five minutes is the server's word** (`error.login_unavailable`), never a
   * subtraction of `expiresAt` from the device's clock: a phone whose clock has run away would
   * otherwise be unable to sign in at all.
   */
  function poll(): Promise<void> {
    const current = request.value
    if (!current || polling || holding) return Promise.resolve()
    polling = true
    polled = ask(current).finally(() => {
      polling = false
      polled = null
    })
    return polled
  }

  async function ask(current: Request): Promise<void> {
    try {
      const answer = await api.pollLogin(current.id)
      if (answer.status === 'authenticated') {
        // Taken even when this window has moved on to another attempt: the session it carries is
        // **this browser's**, whatever the screen has since been asked to do (А4). What holds the
        // app shut is the comparison in `blocked`, so nothing is lost by adopting it here.
        collect(answer.actor, current)
        return
      }
      if (request.value?.id === current.id) failure.value = null
    } catch (error) {
      if (request.value?.id !== current.id) return
      const kind = refused(error)
      // Everything but a dead link keeps the request: the next poll is three seconds away, and
      // a hiccup must not throw away a confirmation the person is about to give.
      if (kind === 'unavailable') drop()
      failure.value = kind
    }
  }

  function collect(view: ActorView, from: Request): void {
    // Снимается тот запрос, который это и принёс. Тот, что человек успел начать после него,
    // живёт дальше: он мог быть уже подтверждён, и выбросить его значило бы просить подтвердить
    // заново (замечание раунда 2, без атаки).
    // Любой собранный вход кончает попытку, и метка снимается (MOL-68): вход в аккаунт,
    // признанный раньше, проходит без вопроса и без `claim` (ревью А1), а чужой по утёкшей
    // ссылке — исход той попытки, и «Это не я» после него — новое начало (ревью Г3).
    if (request.value?.id === from.id) drop(null)
    else keepClaimOnly(null)
    failure.value = null
    refusedOwner.value = null
    // The owner is adopted at once — it is this browser's session now, whosever it is — and what
    // holds the app shut is `blocked`, not an unfinished identity.
    actor.adopt(view)
  }

  /** «Да, это я». */
  function confirm(): void {
    if (actor.actor) claim(actor.actor.id)
  }

  function claim(owner: string): void {
    claimed.value = owner
    refusedOwner.value = null
    // Свой запрос после признания аккаунта смысла не имеет и снимается; чужой остаётся (Р3-2).
    // Человек вошёл — следующий вход с устройства снова начало, а не повтор (MOL-68).
    if (request.value) drop(null)
    else keepClaimOnly(null)
  }

  /**
   * «Это не я». The stranger's session this browser collected is ended on the server first
   * (MOL-57) — until then it stayed alive for its whole term and only this browser stopped using
   * it. Only this session: the stranger's other devices are theirs. Nothing is claimed either
   * way, so a reload or a relaunch asks again instead of walking in, and a fresh login starts
   * right away.
   *
   * A way out that fails does not hold the way in: the person is waiting to sign in as
   * themselves, and the new login replaces the cookie anyway. What is left behind then is a row
   * nobody holds a key to, until its term runs out — named rather than retried.
   */
  async function refuse(): Promise<void> {
    const refused = known.value
    refusedOwner.value = refused
    // A poll already on its way may be bringing this person's own session (MOL-56, А4): what the
    // screen asks about then is that account, and there is neither a stranger to put out nor a
    // login to begin (adversarial Г1).
    // Awaited only when there is one: an empty `await` yields a tick, and a poll starting in it
    // would go out unheld.
    if (polled) await polled
    if (known.value !== refused) return
    holding = true
    try {
      await api.logout()
    } catch {
      // See above: the new login goes ahead regardless.
    } finally {
      holding = false
    }
    if (known.value !== refused) return
    // `begin` ничего не делает, если попытка уже идёт, — и это правильно: её не выбрасывают.
    return begin()
  }

  /**
   * «Повторить» повторяет то, что не вышло (адверсариальный Б2). С тех пор как экран получил
   * собственное состояние ошибки для «сервер не подтвердил личность», кнопка, всегда начинавшая
   * вход, уводила человека в Telegram — с новым запросом против общей квоты — там, где ему нужен
   * был только ответ сервера.
   */
  async function retry(): Promise<void> {
    if (!failure.value && actor.state === 'error') return actor.retry()
    if (request.value) return poll()
    return begin()
  }

  /** What a screen calls when the connection may have come back, or the app came into view. */
  async function reconnected(): Promise<void> {
    connected.value = navigator.onLine
    if (!connected.value) return
    if (failure.value === 'offline') failure.value = null
    if (request.value) return poll()
    return actor.verify()
  }

  return {
    phase,
    blocked,
    closed,
    rechecking,
    starting,
    failure,
    request,
    claimed,
    begin,
    devSignIn,
    again,
    restart,
    poll,
    retry,
    confirm,
    refuse,
    reconnected,
  }
})
