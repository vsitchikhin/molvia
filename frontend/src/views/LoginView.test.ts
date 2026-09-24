import { mount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { actorCodec, ERROR } from '@molvia/model'
import type { ActorView, LoginPoll, LoginStarted } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import { useActorStore } from '@/stores/actor'
import { useLoginStore } from '@/stores/login'
import LoginView from './LoginView.vue'

const startLogin = vi.fn<() => Promise<LoginStarted>>()
const pollLogin = vi.fn<(id: string) => Promise<LoginPoll>>()
const me = vi.fn<() => Promise<ActorView>>()
const devLogin = vi.fn<() => Promise<ActorView>>()
vi.mock('@/api', () => ({
  api: {
    startLogin: () => startLogin(),
    pollLogin: (id: string) => pollLogin(id),
    me: () => me(),
    devLogin: () => devLogin(),
  },
}))

const MINE = actorCodec.parse({
  id: '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f',
  country: 'AM',
  city: 'Гюмри',
  spendCurrency: 'AMD',
  incomeCurrency: 'RUB',
  createdAt: '2026-09-12T00:00:00Z',
  updatedAt: '2026-09-12T00:00:00Z',
})

const REQUEST = {
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  url: `https://t.me/molvia_bot?start=${'a'.repeat(43)}`,
  expiresAt: new Date('2026-09-24T10:05:00.000Z'),
}

const views: VueWrapper[] = []
let opened: ReturnType<typeof vi.spyOn>

/** Экран в том состоянии, в котором его и видят: сессии нет. */
async function render() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const actor = useActorStore()
  me.mockRejectedValue(new ApiError(ERROR.NO_ACTOR))
  await actor.start()
  const view = mount(LoginView, { global: { plugins: [pinia, createAppI18n('en')] } })
  views.push(view)
  await flushPromises()
  return { view, actor, login: useLoginStore() }
}

function button(view: VueWrapper, name: string) {
  const found = view.findAll('button').find((one) => one.text() === name)
  if (!found)
    throw new Error(
      `нет кнопки «${name}»: ${view
        .findAll('button')
        .map((o) => o.text())
        .join(' | ')}`,
    )
  return found
}

beforeEach(() => {
  vi.restoreAllMocks()
  startLogin.mockReset()
  pollLogin.mockReset()
  me.mockReset()
  devLogin.mockReset()
  localStorage.clear()
  sessionStorage.clear()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  opened = vi.spyOn(window, 'open').mockReturnValue(null)
  startLogin.mockResolvedValue(REQUEST)
})

afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  vi.useRealTimers()
})

describe('экран входа', () => {
  it('предлагает войти, а не делает это сам', async () => {
    // Квота — тридцать стартов в скользящую минуту на всю базу: приложение, которое начинает
    // вход при каждом показе экрана, закрывает дверь всем.
    const { view } = await render()

    expect(view.get('h1').text()).toBe('Sign in')
    expect(view.text()).toContain('Sign in with your Telegram')
    expect(startLogin).not.toHaveBeenCalled()
  })

  it('по нажатию заводит запрос и открывает Telegram', async () => {
    const { view } = await render()

    await button(view, 'Sign in with Telegram').trigger('click')
    await flushPromises()

    expect(startLogin).toHaveBeenCalledTimes(1)
    expect(opened).toHaveBeenCalledWith(REQUEST.url, '_blank', 'noopener')
    expect(view.text()).toContain('Open Telegram and tap')
  })

  it('спрашивает сервер, пока экран виден, и молчит спрятанной вкладкой', async () => {
    vi.useFakeTimers()
    const { view } = await render()
    pollLogin.mockResolvedValue({ status: 'pending', expiresAt: REQUEST.expiresAt })
    await button(view, 'Sign in with Telegram').trigger('click')
    await flushPromises()

    await vi.advanceTimersByTimeAsync(7000)
    expect(pollLogin).toHaveBeenCalledTimes(2)

    // На iOS спрятанная вкладка заморожена, и ответ, который она получила бы, некому показать.
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await vi.advanceTimersByTimeAsync(7000)
    expect(pollLogin).toHaveBeenCalledTimes(2)
  })

  it('возврат на вкладку спрашивает немедленно', async () => {
    // Ровно то, чем возвращение из Telegram и выглядит для приложения.
    const { view } = await render()
    pollLogin.mockResolvedValue({ status: 'pending', expiresAt: REQUEST.expiresAt })
    await button(view, 'Sign in with Telegram').trigger('click')
    await flushPromises()
    pollLogin.mockClear()

    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()

    expect(pollLogin).toHaveBeenCalledTimes(1)
  })

  it('повтор ссылки не заводит второго запроса, «Начать заново» — заводит', async () => {
    const { view } = await render()
    pollLogin.mockResolvedValue({ status: 'pending', expiresAt: REQUEST.expiresAt })
    await button(view, 'Sign in with Telegram').trigger('click')
    await flushPromises()

    await button(view, 'Open Telegram').trigger('click')
    expect(startLogin).toHaveBeenCalledTimes(1)

    await button(view, 'Start again').trigger('click')
    await flushPromises()
    expect(startLogin).toHaveBeenCalledTimes(2)
  })
})

describe('в чей аккаунт вошли', () => {
  async function collected() {
    const rendered = await render()
    pollLogin.mockResolvedValue({ status: 'authenticated', actor: MINE })
    await button(rendered.view, 'Sign in with Telegram').trigger('click')
    await flushPromises()
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    return rendered
  }

  it('называет аккаунт и ждёт ответа, прежде чем пустить дальше', async () => {
    const { view, login } = await collected()

    expect(view.text()).toContain('Is this your account?')
    expect(view.text()).toContain('Гюмри · AMD → RUB')
    expect(view.text()).toContain('Account created')
    expect(login.blocked).toBe(true)
  })

  it('«Да, это я» открывает дверь', async () => {
    const { view, login } = await collected()

    await button(view, 'Yes, that is me').trigger('click')

    expect(login.blocked).toBe(false)
  })

  it('«Это не я» дверь не открывает и начинает новый вход', async () => {
    const { view, login } = await collected()

    await button(view, 'That is not me').trigger('click')
    await flushPromises()

    expect(login.blocked).toBe(true)
    expect(startLogin).toHaveBeenCalledTimes(2)
  })
})

describe('когда войти не вышло', () => {
  it('мёртвая ссылка предлагает начать заново', async () => {
    const { view } = await render()
    await button(view, 'Sign in with Telegram').trigger('click')
    await flushPromises()
    pollLogin.mockRejectedValue(new ApiError(ERROR.LOGIN_UNAVAILABLE))

    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()

    expect(view.text()).toContain('This link no longer works')
    expect(button(view, 'Sign in with Telegram').exists()).toBe(true)
  })

  it('квота названа своими словами, а не «что-то пошло не так»', async () => {
    const { view } = await render()
    startLogin.mockRejectedValue(new ApiError(ERROR.LOGIN_RATE_LIMITED))

    await button(view, 'Sign in with Telegram').trigger('click')
    await flushPromises()

    expect(view.text()).toContain('Too many sign-in attempts')
  })

  it('копия без бота говорит об этом и ничего не обещает повторить', async () => {
    const { view } = await render()
    startLogin.mockRejectedValue(new ApiError(ERROR.LOGIN_DISABLED))

    await button(view, 'Sign in with Telegram').trigger('click')
    await flushPromises()

    expect(view.text()).toContain('is not set up')
    expect(view.findAll('button').map((one) => one.text())).not.toContain('Try again')
  })

  it('без сети — жёлтое состояние без кнопки: экран попробует сам', async () => {
    const { view } = await render()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    window.dispatchEvent(new Event('offline'))
    await flushPromises()

    expect(view.text()).toContain('No internet, no sign-in')
    expect(view.find('.warn').exists()).toBe(true)
    expect(view.findAll('button')).toHaveLength(0)
  })
})
