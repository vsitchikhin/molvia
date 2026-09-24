import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
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
 * **The owner nobody has confirmed yet**, because a session can arrive for an account that is
 * not this person's (MOL-55, round 3): whoever sees the link within its five minutes can
 * confirm it with their own Telegram, and the browser that started the login collects *that*
 * account. The screen asks before letting anyone in, and the question has to survive a reload —
 * otherwise reloading is the way past it.
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
  readonly unconfirmed?: string
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
    const { request, unconfirmed } = parsed as Record<string, unknown>
    return {
      ...(isRequest(request) ? { request } : {}),
      ...(typeof unconfirmed === 'string' && UUID.test(unconfirmed) ? { unconfirmed } : {}),
    }
  } catch {
    return {}
  }
}

export const useLoginStore = defineStore('login', () => {
  const actor = useActorStore()
  const kept = recall()
  const request = ref<Request | null>(kept.request ?? null)
  const unconfirmed = ref<string | null>(kept.unconfirmed ?? null)
  const failure = ref<LoginFailure | null>(null)
  const connected = ref(navigator.onLine)
  /** True while `POST /auth/login` is in flight, so the tap has a visible consequence at once. */
  const starting = ref(false)
  /** One request in flight at a time: the interval and a tap must not poll twice over. */
  let polling = false

  window.addEventListener('online', () => {
    connected.value = true
  })
  window.addEventListener('offline', () => {
    connected.value = false
  })

  function keep(): void {
    if (!request.value && !unconfirmed.value) {
      forget(KEY)
      return
    }
    write(
      KEY,
      JSON.stringify({
        ...(request.value ? { request: request.value } : {}),
        ...(unconfirmed.value ? { unconfirmed: unconfirmed.value } : {}),
      }),
    )
  }

  /**
   * **The door stays shut while somebody's account is unconfirmed**, even though the server has
   * already handed this browser a session. That is the whole of the protection: a person is
   * shown which account they landed in before anything of theirs is written into it.
   */
  const blocked = computed(() => unconfirmed.value !== null)

  /**
   * The request comes before the unconfirmed owner on purpose: «Это не я» keeps the question
   * shut *and* starts a new login, and what the person must see then is the new attempt, not
   * the account they have just refused.
   */
  const phase = computed<LoginPhase>(() => {
    if (actor.state === 'idle' || actor.state === 'loading') return 'loading'
    if (failure.value) return failure.value
    if (starting.value || request.value) return 'waiting'
    if (unconfirmed.value) return actor.state === 'ready' ? 'welcome' : 'loading'
    return connected.value ? 'offer' : 'offline'
  })

  // A session that turned out to be gone takes the question with it: there is nobody left to
  // ask about. Without this the screen would hold «is this your account?» over no account.
  // `immediate`, because the store is created by the screen — that is, after the identity has
  // usually already settled, and a watcher that only hears changes would hear nothing.
  watch(
    () => actor.state,
    (state) => {
      if (state === 'signed-out' && unconfirmed.value) {
        unconfirmed.value = null
        keep()
      }
    },
    { immediate: true },
  )

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
   */
  async function devSignIn(): Promise<void> {
    failure.value = null
    if (!(await actor.signIn())) failure.value = navigator.onLine ? 'error' : 'offline'
  }

  /** «Открыть Telegram» again — the same link, never a second request (see `begin`). */
  function again(): void {
    if (request.value) open(request.value.url)
  }

  /** «Начать заново»: the previous request is abandoned, and its secret is about to be replaced. */
  async function restart(): Promise<void> {
    request.value = null
    keep()
    return begin()
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
      // Restarted while the answer was in flight: that request has a secret this browser no
      // longer holds, and its answer is about somebody else's attempt.
      if (request.value?.id !== current.id) return
      if (answer.status === 'authenticated') collect(answer.actor)
      else failure.value = null
    } catch (error) {
      if (request.value?.id !== current.id) return
      const kind = refused(error)
      // Everything but a dead link keeps the request: the next poll is three seconds away, and
      // a hiccup must not throw away a confirmation the person is about to give.
      if (kind === 'unavailable') {
        request.value = null
        keep()
      }
      failure.value = kind
    } finally {
      polling = false
    }
  }

  function collect(view: ActorView): void {
    request.value = null
    unconfirmed.value = view.id
    keep()
    failure.value = null
    // The owner is adopted at once — it is this browser's session now, whosever it is — and
    // what holds the app shut is `blocked`, not an unfinished identity.
    actor.adopt(view)
  }

  /** «Да, это я». */
  function confirm(): void {
    unconfirmed.value = null
    keep()
  }

  /**
   * «Это не я». The session stays on the server — ending it is MOL-57's handle — but this
   * browser stops using it: the question is kept, so a reload or a relaunch asks again instead
   * of walking in, and a fresh login starts right away.
   */
  async function refuse(): Promise<void> {
    request.value = null
    keep()
    return begin()
  }

  /** What a screen calls when the connection may have come back, or the app came into view. */
  async function reconnected(): Promise<void> {
    connected.value = navigator.onLine
    if (!connected.value) return
    if (failure.value === 'offline') failure.value = null
    if (request.value) return poll()
    if (!unconfirmed.value) return actor.recheck()
  }

  return {
    phase,
    blocked,
    starting,
    failure,
    request,
    unconfirmed,
    begin,
    devSignIn,
    again,
    restart,
    poll,
    confirm,
    refuse,
    reconnected,
  }
})
