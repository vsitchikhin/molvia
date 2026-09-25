import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { ActorView } from '@molvia/model'
import { api } from '@/api'
import { forget, read, write } from '@/stores/storage'
import { useActorStore } from '@/stores/actor'

/**
 * The login as the device remembers it — and the device remembers exactly two things.
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
 */
const KEY = 'molvia.login'

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
}

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
    const { request, claimed } = parsed as Record<string, unknown>
    return {
      ...(isRequest(request) ? { request } : {}),
      ...(typeof claimed === 'string' && UUID.test(claimed) ? { claimed } : {}),
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
  /** True while another window's login is being caught up with — see the `storage` listener. */
  const rechecking = ref(false)
  /**
   * The owner the person has just said is not theirs. In memory only: it exists to keep the
   * screen on the new attempt instead of asking the same question again, and a relaunch may
   * ask again — the door is shut either way.
   */
  const refusedOwner = ref<string | null>(null)
  /** One request in flight at a time: the interval and a tap must not poll twice over. */
  let polling = false

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
  function keep(previous?: Request | null): void {
    const stored = recall()
    const mine = previous === undefined || stored.request?.id === previous?.id
    const held = mine ? request.value : (stored.request ?? null)
    if (!held && !claimed.value) {
      forget(KEY)
      return
    }
    write(
      KEY,
      JSON.stringify({
        ...(held ? { request: held } : {}),
        ...(claimed.value ? { claimed: claimed.value } : {}),
      }),
    )
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

  function refused(error: unknown): LoginFailure {
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
    try {
      const started = await api.startLogin()
      request.value = { id: started.id, url: started.url }
      keep()
      open(started.url)
    } catch (error) {
      failure.value = refused(error)
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
  function drop(): void {
    const previous = request.value
    request.value = null
    keep(previous)
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
  async function poll(): Promise<void> {
    const current = request.value
    if (!current || polling) return
    polling = true
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
    } finally {
      polling = false
    }
  }

  function collect(view: ActorView, from: Request): void {
    // Снимается тот запрос, который это и принёс. Тот, что человек успел начать после него,
    // живёт дальше: он мог быть уже подтверждён, и выбросить его значило бы просить подтвердить
    // заново (замечание раунда 2, без атаки).
    if (request.value?.id === from.id) drop()
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
    keep()
  }

  /**
   * «Это не я». The session stays on the server — ending it is MOL-57's handle — but this
   * browser stops using it: nothing is claimed, so a reload or a relaunch asks again instead of
   * walking in, and a fresh login starts right away.
   */
  async function refuse(): Promise<void> {
    refusedOwner.value = known.value
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
