import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { ActorView, LoginPoll, LoginStarted } from '@molvia/model'
import { useActorStore } from '@/stores/actor'
import { useLoginStore } from '@/stores/login'

const startLogin = vi.fn<() => Promise<LoginStarted>>()
const pollLogin = vi.fn<(id: string) => Promise<LoginPoll>>()
const me = vi.fn<() => Promise<ActorView>>()
vi.mock('@/api', () => ({
  api: {
    startLogin: () => startLogin(),
    pollLogin: (id: string) => pollLogin(id),
    me: () => me(),
  },
  onMissingActor: () => undefined,
}))

const KEY = 'molvia.login'
const OWNER = 'molvia.actor'

function actorWith(id: string): ActorView {
  return {
    id,
    country: 'AM',
    city: 'Гюмри',
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
    createdAt: new Date('2026-09-12T10:00:00.000Z'),
    updatedAt: new Date('2026-09-12T10:00:00.000Z'),
  }
}

const MINE = actorWith('9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f')
const STRANGER = actorWith('2c4e6a80-1111-4222-8333-444455556666')

const REQUEST = {
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  url: 'https://t.me/molvia_bot?start=' + 'a'.repeat(43),
  expiresAt: new Date('2026-09-24T10:05:00.000Z'),
}

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

function opened(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(window, 'open').mockReturnValue(null)
}

function kept(): unknown {
  const raw = localStorage.getItem(KEY)
  return raw === null ? null : JSON.parse(raw)
}

/** Приложение, у которого сессии нет: ровно то состояние, в котором виден экран входа. */
async function signedOut() {
  setActivePinia(createPinia())
  const actor = useActorStore()
  me.mockRejectedValue(new ApiError(ERROR.NO_ACTOR))
  await actor.start()
  expect(actor.state).toBe('signed-out')
  return { actor, login: useLoginStore() }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  sessionStorage.clear()
  startLogin.mockReset()
  pollLogin.mockReset()
  me.mockReset()
  online(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('начать вход', () => {
  it('одно нажатие — один запрос, и ссылка открывается', async () => {
    const open = opened()
    const { login } = await signedOut()
    startLogin.mockResolvedValue(REQUEST)

    await login.begin()

    expect(startLogin).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(REQUEST.url, '_blank', 'noopener')
    expect(login.phase).toBe('waiting')
  })

  it('кладёт на устройство ссылку и номер запроса — и ничего больше', async () => {
    // Секрет живёт в `__Host-molvia_login`, которую скрипт не видит. Если бы он оказался здесь,
    // это была бы ровно та ошибка, ради снятия которой эпик и затевался.
    opened()
    const { login } = await signedOut()
    startLogin.mockResolvedValue(REQUEST)

    await login.begin()

    expect(kept()).toEqual({ request: { id: REQUEST.id, url: REQUEST.url } })
  })

  it('«Открыть Telegram» ещё раз не заводит второго запроса', async () => {
    // Квота — тридцать стартов в минуту на всю базу, а новый старт вдобавок перезаписывает
    // секрет в cookie и делает прежний запрос несобираемым.
    const open = opened()
    const { login } = await signedOut()
    startLogin.mockResolvedValue(REQUEST)
    await login.begin()

    login.again()
    await login.begin()

    expect(startLogin).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('«Начать заново» — заводит', async () => {
    opened()
    const { login } = await signedOut()
    startLogin.mockResolvedValue(REQUEST)
    await login.begin()

    await login.restart()

    expect(startLogin).toHaveBeenCalledTimes(2)
  })
})

describe('круг «ушёл в Telegram и вернулся»', () => {
  it('переживает перезапуск приложения', async () => {
    // iOS выгружает PWA, пока человек в Telegram. Без этого подтверждение, которое он дал,
    // приезжать было бы некуда.
    localStorage.setItem(KEY, JSON.stringify({ request: { id: REQUEST.id, url: REQUEST.url } }))
    const { login } = await signedOut()

    expect(login.phase).toBe('waiting')

    pollLogin.mockResolvedValue({ status: 'authenticated', actor: MINE })
    await login.poll()

    expect(pollLogin).toHaveBeenCalledWith(REQUEST.id)
    expect(login.phase).toBe('welcome')
  })

  it('«ещё ждём» ничего не меняет', async () => {
    opened()
    const { login } = await signedOut()
    startLogin.mockResolvedValue(REQUEST)
    await login.begin()
    pollLogin.mockResolvedValue({ status: 'pending', expiresAt: REQUEST.expiresAt })

    await login.poll()

    expect(login.phase).toBe('waiting')
  })

  it('не опрашивает то, чего не начинали', async () => {
    const { login } = await signedOut()

    await login.poll()

    expect(pollLogin).not.toHaveBeenCalled()
  })

  it('ответ на брошенный запрос не считается', async () => {
    // «Начать заново» отдаёт браузеру новый секрет, и ответ прежнего опроса — о чужой попытке.
    opened()
    const { login, actor } = await signedOut()
    startLogin.mockResolvedValue(REQUEST)
    await login.begin()
    let answer: (poll: LoginPoll) => void = () => undefined
    pollLogin.mockReturnValue(
      new Promise<LoginPoll>((resolve) => {
        answer = resolve
      }),
    )

    const flight = login.poll()
    startLogin.mockResolvedValue({ ...REQUEST, id: '11111111-2222-4333-8444-555555555555' })
    await login.restart()
    answer({ status: 'authenticated', actor: STRANGER })
    await flight

    expect(actor.state).toBe('signed-out')
    expect(login.phase).toBe('waiting')
  })
})

describe('в чей аккаунт вошли', () => {
  it('дверь заперта, пока человек не признал аккаунт своим', async () => {
    // Посторонний, которому утекла ссылка, подтверждает её своим Telegram — и браузер забирает
    // сессию его аккаунта (MOL-55, раунд 3). Закрыть это может только экран.
    opened()
    const { login, actor } = await signedOut()
    startLogin.mockResolvedValue(REQUEST)
    await login.begin()
    pollLogin.mockResolvedValue({ status: 'authenticated', actor: STRANGER })

    await login.poll()

    expect(login.phase).toBe('welcome')
    expect(login.blocked).toBe(true)
    // Сессия у браузера уже есть — что держит приложение закрытым, это вопрос, а не личность.
    expect(actor.state).toBe('ready')
    expect(actor.actor?.id).toBe(STRANGER.id)
  })

  it('перезагрузка не проходит мимо вопроса', async () => {
    // Иначе перезагрузка и была бы способом его обойти.
    localStorage.setItem(KEY, JSON.stringify({ unconfirmed: STRANGER.id }))
    localStorage.setItem(OWNER, STRANGER.id)
    setActivePinia(createPinia())
    const actor = useActorStore()
    me.mockResolvedValue(STRANGER)
    const login = useLoginStore()
    await actor.start()

    expect(actor.state).toBe('ready')
    expect(login.blocked).toBe(true)
    expect(login.phase).toBe('welcome')
  })

  it('«Да, это я» открывает дверь и забывает вопрос', async () => {
    opened()
    const { login } = await signedOut()
    startLogin.mockResolvedValue(REQUEST)
    await login.begin()
    pollLogin.mockResolvedValue({ status: 'authenticated', actor: MINE })
    await login.poll()

    login.confirm()

    expect(login.blocked).toBe(false)
    expect(kept()).toBeNull()
  })

  it('«Это не я» держит дверь закрытой и начинает новый вход', async () => {
    // Погасить чужую сессию на сервере нечем до MOL-57, поэтому браузер просто перестаёт ею
    // пользоваться — и помнит об этом после перезапуска.
    opened()
    const { login } = await signedOut()
    startLogin.mockResolvedValue(REQUEST)
    await login.begin()
    pollLogin.mockResolvedValue({ status: 'authenticated', actor: STRANGER })
    await login.poll()

    const next = { ...REQUEST, id: '11111111-2222-4333-8444-555555555555' }
    startLogin.mockResolvedValue(next)
    await login.refuse()

    expect(login.blocked).toBe(true)
    expect(login.phase).toBe('waiting')
    expect(kept()).toEqual({
      request: { id: next.id, url: next.url },
      unconfirmed: STRANGER.id,
    })
  })

  it('вопрос закрывает дверь и во втором окне', async () => {
    // Две вкладки делят банку cookie: сессия, забранная в одной, — это сессия и другой. Окно,
    // которое уже было открыто, иначе вошло бы в аккаунт, которого никто не признавал.
    const { login } = await signedOut()
    expect(login.blocked).toBe(false)

    localStorage.setItem(KEY, JSON.stringify({ unconfirmed: STRANGER.id }))
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }))

    expect(login.blocked).toBe(true)
  })

  it('и открывает её, когда в соседнем окне ответили «да, это я»', async () => {
    localStorage.setItem(KEY, JSON.stringify({ unconfirmed: STRANGER.id }))
    localStorage.setItem(OWNER, STRANGER.id)
    setActivePinia(createPinia())
    const actor = useActorStore()
    me.mockResolvedValue(STRANGER)
    const login = useLoginStore()
    await actor.start()
    expect(login.blocked).toBe(true)

    localStorage.removeItem(KEY)
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }))

    expect(login.blocked).toBe(false)
  })

  it('и вопрос уходит вместе с сессией, которой не стало', async () => {
    localStorage.setItem(KEY, JSON.stringify({ unconfirmed: STRANGER.id }))
    const { login } = await signedOut()

    expect(login.blocked).toBe(false)
    expect(kept()).toBeNull()
  })
})

describe('отказы', () => {
  it('мёртвая ссылка забывается, чтобы начать заново', async () => {
    opened()
    const { login } = await signedOut()
    startLogin.mockResolvedValue(REQUEST)
    await login.begin()
    pollLogin.mockRejectedValue(new ApiError(ERROR.LOGIN_UNAVAILABLE))

    await login.poll()

    expect(login.phase).toBe('unavailable')
    expect(kept()).toBeNull()
  })

  it('квота и ненастроенный вход названы по-своему', async () => {
    const { login } = await signedOut()
    startLogin.mockRejectedValue(new ApiError(ERROR.LOGIN_RATE_LIMITED))
    await login.begin()
    expect(login.phase).toBe('rate_limited')

    startLogin.mockRejectedValue(new ApiError(ERROR.LOGIN_DISABLED))
    await login.begin()
    expect(login.phase).toBe('disabled')
  })

  it('сбой сервера — это «ошибка», а не «нет связи»', async () => {
    const { login } = await signedOut()
    startLogin.mockRejectedValue(new ApiError(ERROR.INTERNAL))

    await login.begin()

    expect(login.phase).toBe('error')
  })

  it('сбой без связи — это офлайн, и решает это состояние после отказа', async () => {
    // `navigator.onLine` читается после провала, а не до запроса: связь, пропавшая, пока ответ
    // летел, — самый частый обрыв у полки (MOL-19, A1).
    opened()
    const { login } = await signedOut()
    startLogin.mockResolvedValue(REQUEST)
    await login.begin()
    online(false)
    pollLogin.mockRejectedValue(new ApiError(ERROR.INTERNAL))

    await login.poll()

    expect(login.phase).toBe('offline')
    // Запрос остаётся: человек мог уже нажать «Войти», и выбрасывать подтверждение нельзя.
    expect(kept()).toEqual({ request: { id: REQUEST.id, url: REQUEST.url } })
  })

  it('связь вернулась — опрос продолжается сам', async () => {
    opened()
    const { login } = await signedOut()
    startLogin.mockResolvedValue(REQUEST)
    await login.begin()
    online(false)
    pollLogin.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    await login.poll()
    expect(login.phase).toBe('offline')

    online(true)
    pollLogin.mockReset()
    pollLogin.mockResolvedValue({ status: 'authenticated', actor: MINE })
    await login.reconnected()

    expect(login.phase).toBe('welcome')
  })

  it('без сети и без запроса — офлайн, а не предложение войти', async () => {
    const { login } = await signedOut()
    expect(login.phase).toBe('offer')

    online(false)
    window.dispatchEvent(new Event('offline'))

    expect(login.phase).toBe('offline')
  })
})

describe('что лежит на устройстве, проверяется', () => {
  it('ссылка не на t.me не открывается', async () => {
    // Хранилище — единственный вход сюда, который никто не проверял на проводе.
    localStorage.setItem(
      KEY,
      JSON.stringify({ request: { id: REQUEST.id, url: 'javascript:alert(1)' } }),
    )
    const { login } = await signedOut()

    expect(login.phase).toBe('offer')
  })

  it('мусор вместо записи — как будто записи нет', async () => {
    localStorage.setItem(KEY, 'не json')
    const { login } = await signedOut()

    expect(login.phase).toBe('offer')
  })
})
