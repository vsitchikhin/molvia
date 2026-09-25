import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { ActorView, LoginPoll, LoginStarted } from '@molvia/model'
import { sessionEnded, useActorStore } from '@/stores/actor'
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

  it('«ещё ждём» на брошенный запрос ничего не трогает', async () => {
    // Ответ со сбором сессии — другое дело, он берётся всегда: см. «А4» ниже.
    opened()
    const { login } = await signedOut()
    startLogin.mockResolvedValue(REQUEST)
    await login.begin()
    let answer: (poll: LoginPoll) => void = () => undefined
    pollLogin.mockReturnValue(
      new Promise<LoginPoll>((resolve) => {
        answer = resolve
      }),
    )

    const flight = login.poll()
    const next = { ...REQUEST, id: '11111111-2222-4333-8444-555555555555' }
    startLogin.mockResolvedValue(next)
    await login.restart()
    answer({ status: 'pending', expiresAt: REQUEST.expiresAt })
    await flight

    expect(login.request?.id).toBe(next.id)
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
    expect(login.closed).toBe(true)
    // Сессия у браузера уже есть — дверь держит не незаконченная личность, а сравнение.
    expect(actor.state).toBe('ready')
    expect(actor.actor?.id).toBe(STRANGER.id)
  })

  it('перезагрузка не проходит мимо вопроса', async () => {
    // Иначе перезагрузка и была бы способом его обойти.
    localStorage.setItem(OWNER, STRANGER.id)
    setActivePinia(createPinia())
    const actor = useActorStore()
    me.mockResolvedValue(STRANGER)
    const login = useLoginStore()
    await actor.start()

    expect(actor.state).toBe('ready')
    expect(login.closed).toBe(true)
    expect(login.phase).toBe('welcome')
  })

  it('сбор снимает свой запрос и не трогает начатый после него', async () => {
    // Иначе «Начать заново» с уже подтверждённым R2 заставляло бы подтверждать заново.
    opened()
    const { login } = await signedOut()
    startLogin.mockResolvedValueOnce(REQUEST)
    await login.begin()
    let answer: (poll: LoginPoll) => void = () => undefined
    pollLogin.mockReturnValueOnce(
      new Promise<LoginPoll>((resolve) => {
        answer = resolve
      }),
    )
    const flight = login.poll()
    const next = { ...REQUEST, id: '11111111-2222-4333-8444-555555555555' }
    startLogin.mockResolvedValueOnce(next)
    await login.restart()

    answer({ status: 'authenticated', actor: STRANGER })
    await flight

    expect(login.request?.id).toBe(next.id)
    expect(login.closed).toBe(true)
  })

  it('«Да, это я» открывает дверь и записывает, кого признали', async () => {
    opened()
    const { login } = await signedOut()
    startLogin.mockResolvedValue(REQUEST)
    await login.begin()
    pollLogin.mockResolvedValue({ status: 'authenticated', actor: MINE })
    await login.poll()

    login.confirm()

    expect(login.closed).toBe(false)
    expect(kept()).toEqual({ claimed: MINE.id })
  })

  it('свой аккаунт, признанный раньше, второй раз не спрашивают', async () => {
    localStorage.setItem(KEY, JSON.stringify({ claimed: MINE.id }))
    localStorage.setItem(OWNER, MINE.id)
    setActivePinia(createPinia())
    const actor = useActorStore()
    me.mockResolvedValue(MINE)
    const login = useLoginStore()

    await actor.start()

    expect(login.closed).toBe(false)
  })

  it('«Это не я» держит дверь закрытой и начинает новый вход', async () => {
    // Погасить чужую сессию на сервере нечем до MOL-57, поэтому браузер просто перестаёт ею
    // пользоваться — и помнит об этом после перезапуска, потому что признан никто.
    opened()
    const { login } = await signedOut()
    startLogin.mockResolvedValue(REQUEST)
    await login.begin()
    pollLogin.mockResolvedValue({ status: 'authenticated', actor: STRANGER })
    await login.poll()

    const next = { ...REQUEST, id: '11111111-2222-4333-8444-555555555555' }
    startLogin.mockResolvedValue(next)
    await login.refuse()

    expect(login.closed).toBe(true)
    expect(login.phase).toBe('waiting')
    expect(kept()).toEqual({ request: { id: next.id, url: next.url } })
  })

  it('чужой вход в соседнем окне закрывает дверь здесь — и показывает того, кто пришёл', async () => {
    // Две вкладки делят банку cookie. Окно, которое сессию не забирало, иначе продолжало бы
    // показывать приложение того владельца, в которого верило минуту назад (ревью Р2-1).
    localStorage.setItem(KEY, JSON.stringify({ claimed: MINE.id }))
    localStorage.setItem(OWNER, MINE.id)
    setActivePinia(createPinia())
    const actor = useActorStore()
    me.mockResolvedValue(MINE)
    const login = useLoginStore()
    await actor.start()
    expect(login.closed).toBe(false)

    // Соседнее окно собрало вход: в банке cookie теперь чужая сессия, а запрос с устройства ушёл.
    me.mockResolvedValue(STRANGER)
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }))

    // Пока идёт переспрос, дверь уже закрыта, а вопрос ещё не показан: окно не знает, чью
    // сессию держит, и рисовать карточку по прежнему владельцу было бы ложью (Р2-1).
    expect(login.closed).toBe(true)
    expect(login.phase).toBe('loading')

    await vi.waitFor(() => {
      expect(login.phase).toBe('welcome')
    })
    // Карточка вопроса рисуется по `actor.actor` — и это уже тот, кто пришёл, а не прежний.
    expect(actor.actor?.id).toBe(STRANGER.id)
    expect(login.closed).toBe(true)
  })

  it('и открывает её, когда в соседнем окне ответили «да, это я»', async () => {
    localStorage.setItem(OWNER, STRANGER.id)
    setActivePinia(createPinia())
    const actor = useActorStore()
    me.mockResolvedValue(STRANGER)
    const login = useLoginStore()
    await actor.start()
    expect(login.closed).toBe(true)

    localStorage.setItem(KEY, JSON.stringify({ claimed: STRANGER.id }))
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }))

    await vi.waitFor(() => {
      expect(login.closed).toBe(false)
    })
  })
})

describe('вопрос нельзя обойти ни отказом, ни потерянным ответом', () => {
  it('А1: запоздалый 401 не стирает вопрос', async () => {
    // `error.no_actor` — правда про момент, когда запрос уходил. Ответ, застрявший в пути до
    // входа, приходит уже после него, и раньше он снимал вопрос вместе с записью на устройстве.
    opened()
    const { login, actor } = await signedOut()
    startLogin.mockResolvedValue(REQUEST)
    await login.begin()
    pollLogin.mockResolvedValue({ status: 'authenticated', actor: STRANGER })
    await login.poll()
    expect(login.closed).toBe(true)

    me.mockResolvedValue(STRANGER)
    sessionEnded()
    await vi.waitFor(() => {
      expect(me).toHaveBeenCalled()
    })

    expect(login.closed).toBe(true)
    expect(actor.actor?.id).toBe(STRANGER.id)
    expect(login.phase).toBe('welcome')
  })

  it('А4: ответ опроса, пришедший после «Начать заново», всё равно берут', async () => {
    // Сервер погасил запрос и ответил с `Set-Cookie`: сессия у браузера уже есть, что бы потом
    // ни решил скрипт. Отбросить такой ответ значило пустить в аккаунт без вопроса.
    opened()
    const { login, actor } = await signedOut()
    startLogin.mockResolvedValueOnce(REQUEST)
    await login.begin()
    let answer: (poll: LoginPoll) => void = () => undefined
    pollLogin.mockReturnValueOnce(
      new Promise<LoginPoll>((resolve) => {
        answer = resolve
      }),
    )
    const flight = login.poll()

    startLogin.mockResolvedValueOnce({ ...REQUEST, id: '11111111-2222-4333-8444-555555555555' })
    await login.restart()
    answer({ status: 'authenticated', actor: STRANGER })
    await flight

    expect(actor.actor?.id).toBe(STRANGER.id)
    expect(login.closed).toBe(true)
    expect(login.phase).toBe('welcome')
  })

  it('А4: и перезапуск с неувиденным ответом тоже спрашивает', async () => {
    // Человек вернулся из Telegram, опрос ушёл, приложение перезапустилось. Скрипт ответа не
    // видел, а сессия у браузера есть — и на устройстве всё ещё висит запрос.
    localStorage.setItem(KEY, JSON.stringify({ request: { id: REQUEST.id, url: REQUEST.url } }))
    localStorage.setItem(OWNER, STRANGER.id)
    setActivePinia(createPinia())
    const actor = useActorStore()
    me.mockResolvedValue(STRANGER)
    const login = useLoginStore()

    await actor.start()

    expect(login.closed).toBe(true)
    expect(login.phase).toBe('welcome')
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

describe('«Повторить» повторяет то, что не вышло', () => {
  it('Б2: ошибка проверки личности переспрашивает сервер, а не ведёт в Telegram', async () => {
    // Человеку нужен был ответ сервера, чтобы увидеть свой вопрос, — а кнопка заводила новый
    // вход: лишний старт против общей квоты и Telegram поверх экрана.
    localStorage.setItem(OWNER, STRANGER.id)
    setActivePinia(createPinia())
    const actor = useActorStore()
    const login = useLoginStore()
    me.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    await actor.start()
    expect(login.phase).toBe('error')

    await login.retry()

    expect(startLogin).not.toHaveBeenCalled()
    expect(me).toHaveBeenCalledTimes(2)
  })

  it('а ошибка самого входа — начинает его заново', async () => {
    opened()
    const { login } = await signedOut()
    startLogin.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL))
    await login.begin()
    expect(login.phase).toBe('error')

    startLogin.mockResolvedValue(REQUEST)
    await login.retry()

    expect(login.phase).toBe('waiting')
  })
})

describe('экран не застревает и не открывает дверь мимо владельца', () => {
  it('А2: соседнее окно собрало вход — здесь вопрос, а не вечный скелет', async () => {
    const { login } = await signedOut()
    expect(login.phase).toBe('offer')

    me.mockResolvedValue(STRANGER)
    localStorage.setItem(KEY, JSON.stringify({ claimed: MINE.id }))
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }))

    await vi.waitFor(() => {
      expect(login.phase).toBe('welcome')
    })
  })

  it('А2: перезапуск без сети при непризнанном владельце — «нет связи», а не загрузка', async () => {
    // MOL-19: у каждого экрана есть состояние «нет связи». Бесконечная загрузка — не оно.
    localStorage.setItem(OWNER, STRANGER.id)
    online(false)
    setActivePinia(createPinia())
    const actor = useActorStore()
    const login = useLoginStore()

    await actor.start()

    expect(actor.state).toBe('offline')
    expect(login.closed).toBe(true)
    expect(login.phase).toBe('offline')
  })

  it('А5: новый телефон, API не ответил — дверь закрыта, а не приложение без владельца', async () => {
    // Портал магазина отвечает `onLine === true`, и правило «пустому устройству показывать
    // нечего» мимо него проходило: приложение открывалось с плашкой, но без ящиков.
    // Модули заново: `identity.ts` держит владельца в памяти модуля, а телефон — новый.
    vi.resetModules()
    const freshActor = await import('@/stores/actor')
    const freshLogin = await import('@/stores/login')
    setActivePinia(createPinia())
    const actor = freshActor.useActorStore()
    const login = freshLogin.useLoginStore()
    me.mockRejectedValue(new ApiError(ERROR.INTERNAL))

    await actor.start()

    expect(actor.state).toBe('error')
    expect(actor.id).toBeNull()
    expect(login.closed).toBe(true)
    expect(login.phase).toBe('error')
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

  it('Р3-2: «Да, это я» не стирает запрос соседнего окна', async () => {
    // Окно без своего запроса писало `{claimed}` поверх чужого — ровно то, что закрывало А3.
    localStorage.setItem(OWNER, STRANGER.id)
    setActivePinia(createPinia())
    const actor = useActorStore()
    me.mockResolvedValue(STRANGER)
    const login = useLoginStore()
    await actor.start()
    // Соседнее окно начало свой вход уже после того, как это окно открылось: запрос лежит на
    // устройстве, но этому окну он не принадлежит.
    const neighbour = { id: '11111111-2222-4333-8444-555555555555', url: REQUEST.url }
    localStorage.setItem(KEY, JSON.stringify({ request: neighbour }))

    login.confirm()

    expect(login.closed).toBe(false)
    expect(kept()).toEqual({ request: neighbour, claimed: STRANGER.id })
  })

  it('а свой запрос после признания аккаунта снимает', async () => {
    opened()
    const { login, actor } = await signedOut()
    startLogin.mockResolvedValue(REQUEST)
    await login.begin()
    // Сессия пришла мимо скрипта: запрос на устройстве остался, а сервер зовёт нас MINE.
    me.mockResolvedValue(MINE)
    await actor.verify()

    login.confirm()

    expect(kept()).toEqual({ claimed: MINE.id })
  })

  it('А3: окно с мёртвой ссылкой не стирает запрос соседнего окна', async () => {
    // Ключ общий, а запрос — личное дело окна: чужой `forget` уносил подтверждение, которому
    // потом некуда приходить, если соседнюю вкладку iOS уже выгрузил.
    opened()
    const { login } = await signedOut()
    startLogin.mockResolvedValue(REQUEST)
    await login.begin()
    const neighbour = { id: '11111111-2222-4333-8444-555555555555', url: REQUEST.url }
    localStorage.setItem(KEY, JSON.stringify({ request: neighbour }))

    pollLogin.mockRejectedValue(new ApiError(ERROR.LOGIN_UNAVAILABLE))
    await login.poll()

    expect(login.phase).toBe('unavailable')
    expect(kept()).toEqual({ request: neighbour })
  })

  it('мусор вместо записи — как будто записи нет', async () => {
    localStorage.setItem(KEY, 'не json')
    const { login } = await signedOut()

    expect(login.phase).toBe('offer')
  })
})
