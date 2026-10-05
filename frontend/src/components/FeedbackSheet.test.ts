import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ApiError } from '@molvia/client'
import { ERROR, FEEDBACK_TEXT_MAX, ISSUE } from '@molvia/model'
import type { FeedbackBody, FeedbackSent } from '@molvia/model'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import { pwaUpdateKey, NO_UPDATE } from '@/pwaUpdate'
import { routes } from '@/router'
import FeedbackSheet from '@/components/FeedbackSheet.vue'
import type * as FeedbackPictureExports from '@/feedbackPicture'
import { useActorStore } from '@/stores/actor'
import {
  dropFeedbackDraft,
  feedbackSent,
  keepFeedbackDraft,
  recallFeedbackDraft,
} from '@/stores/feedbackDraft'
import { useFeedbackSheetStore, type FeedbackEntry } from '@/stores/feedbackSheet'

const sendFeedback =
  vi.fn<(body: FeedbackBody) => Promise<{ sent: FeedbackSent; created: boolean }>>()
vi.mock('@/api', () => ({
  api: { sendFeedback: (body: FeedbackBody) => sendFeedback(body) },
}))

type FeedbackPictureModule = typeof FeedbackPictureExports

// No canvas in happy-dom: the drawing is `feedbackPicture.test.ts`'s, the sheet takes what it gives.
const drawPicture = vi.fn<(file: Blob) => Promise<{ jpeg: Blob; width: number; height: number }>>()
vi.mock('@/feedbackPicture', async (actual) => ({
  ...(await actual<FeedbackPictureModule>()),
  pictureFromFile: (file: Blob) => drawPicture(file),
}))

const OWNER = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'

const mounted: VueWrapper[] = []
let clock = 0

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

/** The sheet over a screen, the way `App.vue` holds it: mounted once, shut until a way in opens it. */
async function render(screen = '/settings', build: string | null = null) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(screen)
  const wrapper = mount(FeedbackSheet, {
    attachTo: document.body,
    global: {
      plugins: [router, createAppI18n('en')],
      provide: { [pwaUpdateKey as symbol]: { ...NO_UPDATE, build: () => build } },
    },
  })
  mounted.push(wrapper)
  return { wrapper, router }
}

/** Opened as a way in opens it, and given the time to rise and to say its first words. */
async function open(wrapper: VueWrapper, entry: FeedbackEntry = { from: 'settings' }) {
  useFeedbackSheetStore().open(entry)
  await flushPromises()
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 120))
  return wrapper
}

const radios = (sheet: VueWrapper) => sheet.findAll<HTMLInputElement>('input[type="radio"]')
const textarea = (sheet: VueWrapper) => sheet.get<HTMLTextAreaElement>('textarea')
const button = (sheet: VueWrapper) => sheet.get('.footer button')
const attached = (sheet: VueWrapper) => sheet.get('.attached').text().replace(/\s+/g, ' ')

async function choose(sheet: VueWrapper, label: string): Promise<void> {
  const radio = sheet
    .findAll('label')
    .find((candidate) => candidate.text() === label)
    ?.find('input')
  if (!radio?.exists()) throw new Error(`no kind «${label}»`)
  await radio.setValue(true)
}

async function type(sheet: VueWrapper, text: string): Promise<void> {
  await textarea(sheet).setValue(text)
}

async function press(sheet: VueWrapper): Promise<void> {
  await button(sheet).trigger('click')
  await flushPromises()
}

beforeEach(() => {
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  setActivePinia(createPinia())
  useActorStore().id = OWNER
  sendFeedback.mockReset()
  sendFeedback.mockResolvedValue({ sent: { number: 42 }, created: true })
  online(true)
  localStorage.clear()
  sessionStorage.clear()
  drawPicture.mockReset()
  drawPicture.mockImplementation((file) =>
    Promise.resolve({ jpeg: new Blob([file], { type: 'image/jpeg' }), width: 1179, height: 2556 }),
  )
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('«Write to the developer» from the settings', () => {
  it('chooses no kind for the person, and the button says what it waits for', async () => {
    const { wrapper } = await render()
    const sheet = await open(wrapper)

    expect(sheet.get('h2').text()).toBe(en.feedback.title)
    expect(radios(sheet).some((radio) => radio.element.checked)).toBe(false)
    expect(button(sheet).text()).toBe(en.feedback.need_kind)
    expect(button(sheet).attributes('aria-disabled')).toBe('true')
    // Inactive, not disabled: it keeps its focus and its words.
    expect(button(sheet).attributes('disabled')).toBeUndefined()
  })

  it('gives the reasons in the order a person can put them right: kind, text, day, connection', async () => {
    sendFeedback.mockRejectedValue(new ApiError(ERROR.FEEDBACK_RATE_LIMITED))
    const { wrapper } = await render()
    const sheet = await open(wrapper)

    online(false)
    window.dispatchEvent(new Event('offline'))
    await flushPromises()
    expect(button(sheet).text()).toBe(en.feedback.need_kind)
    await choose(sheet, en.feedback.kinds.idea)
    expect(button(sheet).text()).toBe(en.feedback.need_text)
    await type(sheet, 'A list of my own shops')
    expect(button(sheet).text()).toBe(en.feedback.need_network)

    online(true)
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    await press(sheet)
    online(false)
    window.dispatchEvent(new Event('offline'))
    await flushPromises()
    expect(button(sheet).text()).toBe(en.feedback.need_tomorrow)
  })

  it('lets the text be typed before the kind, and still asks for the kind', async () => {
    const { wrapper } = await render()
    const sheet = await open(wrapper)

    await type(sheet, 'Something')

    expect(button(sheet).text()).toBe(en.feedback.need_kind)
    await press(sheet)
    expect(sendFeedback).not.toHaveBeenCalled()
  })

  it('asks for a text that draws something', async () => {
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.other)

    for (const blank of ['', '   ', '\n\n', String.fromCodePoint(0x200b)]) {
      await type(sheet, blank)
      expect(button(sheet).text(), JSON.stringify(blank)).toBe(en.feedback.need_text)
    }
  })

  it('changes the hint of the field with the kind', async () => {
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    const hint = () => textarea(sheet).attributes('placeholder')

    expect(hint()).toBe(en.feedback.placeholder.any)
    await choose(sheet, en.feedback.kinds.bug)
    expect(hint()).toBe(en.feedback.placeholder.bug)
    await choose(sheet, en.feedback.kinds.idea)
    expect(hint()).toBe(en.feedback.placeholder.idea)
    await choose(sheet, en.feedback.kinds.other)
    expect(hint()).toBe(en.feedback.placeholder.any)
  })

  it('sends what the sheet shows, and nothing else', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ANDROID)
    const { wrapper } = await render('/settings', 'v0.2.0-4-gab12cd3')
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.idea)
    await type(sheet, '  A list of my own shops\t\n\n\n')

    expect(button(sheet).text()).toBe(en.feedback.send)
    await press(sheet)

    expect(sendFeedback).toHaveBeenCalledOnce()
    const body = sendFeedback.mock.calls[0]?.[0]
    expect(body).toEqual({
      kind: 'idea',
      text: 'A list of my own shops',
      locale: 'en',
      pageBuild: 'v0.2.0-4-gab12cd3',
      route: 'settings',
      platform: 'android 15 browser',
      fromError: false,
      errorCode: null,
      clientKey: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
    })
  })
})

describe('the focus as it opens', () => {
  it('goes to the kinds when none is chosen yet, and into the field once one is', async () => {
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    expect(document.activeElement).toBe(radios(sheet)[0]?.element)

    await choose(sheet, en.feedback.kinds.idea)
    useFeedbackSheetStore().shown = false
    await flushPromises()
    await open(wrapper)
    expect(document.activeElement).toBe(textarea(sheet).element)
  })

  it('goes into the field from an error screen: the kind is said by the link', async () => {
    const { wrapper } = await render('/money')
    const sheet = await open(wrapper, { from: 'error', code: null })

    expect(document.activeElement).toBe(textarea(sheet).element)
  })
})

describe('what goes with the text (MOL-150, Р-7)', () => {
  it('is shown before sending: the build whole, the screen, the language, the platform in words', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ANDROID)
    const { wrapper } = await render('/settings', 'v0.2.0-4-gab12cd3')
    const sheet = await open(wrapper)

    expect(attached(sheet)).toBe(
      `${en.feedback.attached} version v0.2.0-4-gab12cd3 · screen “Settings” · English · Android 15, browser`,
    )
  })

  it('has no version where the page met no build — the dev server', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ANDROID)
    const { wrapper } = await render()
    const sheet = await open(wrapper)

    expect(attached(sheet)).toBe(
      `${en.feedback.attached} screen “Settings” · English · Android 15, browser`,
    )
  })

  it('names a system it does not know in words, not by its code', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (PlayStation 5)')
    const { wrapper } = await render()
    const sheet = await open(wrapper)

    expect(attached(sheet)).toContain('another system, browser')
    expect(attached(sheet)).not.toMatch(/\bother\b/)
  })

  it('takes the screen it was opened over, whatever screen the draft began on (Р-6)', async () => {
    const { wrapper, router } = await render('/money')
    const sheet = await open(wrapper, { from: 'error', code: 'error.internal' })
    await type(sheet, 'The month did not load')
    useFeedbackSheetStore().shown = false
    await flushPromises()

    await router.push('/settings')
    await open(wrapper)

    expect(attached(sheet)).toContain('screen “Settings”')
    expect(attached(sheet)).not.toContain('error.internal')
    expect(textarea(sheet).element.value).toBe('The month did not load')
    await press(sheet)
    expect(sendFeedback.mock.calls[0]?.[0]).toMatchObject({
      route: 'settings',
      fromError: false,
      errorCode: null,
    })
  })
})

describe('«Report a problem» from an error screen', () => {
  it('opens on «Broken», titled as the link was, with the code of the refusal', async () => {
    const { wrapper } = await render('/money')
    const sheet = await open(wrapper, { from: 'error', code: 'error.internal' })

    expect(sheet.get('h2').text()).toBe(en.feedback.title_error)
    const checked = radios(sheet).find((radio) => radio.element.checked)
    expect(checked?.element.value).toBe('bug')
    expect(attached(sheet)).toContain('screen “Money” · ')
    expect(attached(sheet)).toContain('code error.internal')

    await type(sheet, 'The month did not load')
    await press(sheet)
    expect(sendFeedback.mock.calls[0]?.[0]).toMatchObject({
      kind: 'bug',
      route: 'money',
      fromError: true,
      errorCode: 'error.internal',
    })
  })

  it('goes without a code when no refusal was fresh, and says none', async () => {
    const { wrapper } = await render('/money')
    const sheet = await open(wrapper, { from: 'error', code: null })

    expect(attached(sheet)).not.toContain('code')
    await type(sheet, 'Nothing loads')
    await press(sheet)
    expect(sendFeedback.mock.calls[0]?.[0]).toMatchObject({ fromError: true, errorCode: null })
  })
})

describe('the draft (MOL-147, Р-2)', () => {
  it('keeps the kind the person chose when an error screen opens it and nothing is touched (В4)', async () => {
    const { wrapper } = await render('/money')
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.idea)
    await type(sheet, 'A list of my own shops')
    useFeedbackSheetStore().shown = false
    await flushPromises()

    await open(wrapper, { from: 'error', code: null })
    expect(radios(sheet).find((radio) => radio.element.checked)?.element.value).toBe('bug')
    useFeedbackSheetStore().shown = false
    await flushPromises()

    expect(recallFeedbackDraft(OWNER)?.kind).toBe('idea')
    await open(wrapper)
    expect(radios(sheet).find((radio) => radio.element.checked)?.element.value).toBe('idea')
  })

  it('outlives closing the sheet, and a launch', async () => {
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.idea)
    await type(sheet, 'A list of my own shops')
    useFeedbackSheetStore().shown = false
    await flushPromises()

    expect(recallFeedbackDraft(OWNER)).toMatchObject({
      kind: 'idea',
      text: 'A list of my own shops',
    })
    await open(wrapper)
    expect(radios(sheet).find((radio) => radio.element.checked)?.element.value).toBe('idea')
    expect(textarea(sheet).element.value).toBe('A list of my own shops')
  })

  it('is kept under the person, and nobody else opens it', async () => {
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.idea)
    await type(sheet, 'Mine')
    useFeedbackSheetStore().shown = false
    await flushPromises()

    useActorStore().id = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
    await open(wrapper)

    expect(textarea(sheet).element.value).toBe('')
    expect(recallFeedbackDraft(OWNER)?.text).toBe('Mine')
  })

  it('takes a new key with every change of the content, and keeps it while nothing changes', async () => {
    sendFeedback.mockRejectedValue(new TypeError('Failed to fetch'))
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.bug)
    await type(sheet, 'First')
    const first = recallFeedbackDraft(OWNER)?.clientKey

    await type(sheet, 'First, amended')
    const amended = recallFeedbackDraft(OWNER)?.clientKey
    expect(amended).not.toBe(first)
    await choose(sheet, en.feedback.kinds.other)
    expect(recallFeedbackDraft(OWNER)?.clientKey).not.toBe(amended)

    await press(sheet)
    await press(sheet)
    const [one, two] = sendFeedback.mock.calls.map(([body]) => body.clientKey)
    expect(one).toBe(two)
    expect(one).toBe(recallFeedbackDraft(OWNER)?.clientKey)
  })

  it('is forgotten once sent, and the sheet says thanks with no number', async () => {
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.idea)
    await type(sheet, 'A list of my own shops')

    await press(sheet)

    expect(recallFeedbackDraft(OWNER)).toBeNull()
    expect(feedbackSent(OWNER, sendFeedback.mock.calls[0]?.[0].clientKey ?? '')).toBe(true)
    expect(sheet.get('.sent').text()).toContain(en.feedback.sent.title)
    expect(sheet.get('.spoken').text()).toBe(`${en.feedback.sent.title}. ${en.feedback.sent.body}`)
    expect(sheet.text()).not.toContain('42')
    expect(sheet.find('textarea').exists()).toBe(false)
    expect(button(sheet).text()).toBe(en.feedback.done)

    await press(sheet)
    expect(useFeedbackSheetStore().shown).toBe(false)
    await open(wrapper)
    expect(radios(sheet).some((radio) => radio.element.checked)).toBe(false)
    expect(textarea(sheet).element.value).toBe('')
  })

  it('must not forget a draft changed while the first one was on its way', async () => {
    let answer: (value: { sent: FeedbackSent; created: boolean }) => void = () => undefined
    sendFeedback.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.idea)
    await type(sheet, 'First')
    await button(sheet).trigger('click')
    useFeedbackSheetStore().shown = false
    await flushPromises()
    await open(wrapper)
    await type(sheet, 'Second')

    answer({ sent: { number: 7 }, created: true })
    await flushPromises()

    expect(recallFeedbackDraft(OWNER)?.text).toBe('Second')
  })
})

describe('a message that may have left already (adversarial В1, В2)', () => {
  it('goes again with what went with it, whatever screen or code the sheet is opened with now', async () => {
    sendFeedback.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const { wrapper, router } = await render('/money')
    const sheet = await open(wrapper, { from: 'error', code: 'issue.response_invalid' })
    await type(sheet, 'The list did not load')
    await press(sheet)
    useFeedbackSheetStore().shown = false
    await flushPromises()

    await router.push('/settings')
    await open(wrapper, { from: 'error', code: 'error.internal' })

    expect(attached(sheet)).toContain('screen “Money”')
    expect(attached(sheet)).toContain('code issue.response_invalid')
    await press(sheet)
    const [first, again] = sendFeedback.mock.calls.map(([body]) => body)
    expect(again).toEqual(first)
  })

  it('goes again with the build it left with, after a reload onto another', async () => {
    sendFeedback.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const before = await render('/settings', 'v0.1.3-20-gd90f9cee')
    await open(before.wrapper)
    await choose(before.wrapper, en.feedback.kinds.idea)
    await type(before.wrapper, 'A list of my own shops')
    await press(before.wrapper)
    before.wrapper.unmount()
    setActivePinia(createPinia())
    useActorStore().id = OWNER

    const after = await render('/settings', 'v0.1.4-3-gabc12345')
    await open(after.wrapper)
    await press(after.wrapper)

    const [first, again] = sendFeedback.mock.calls.map(([body]) => body)
    expect(again).toEqual(first)
    expect(again?.pageBuild).toBe('v0.1.3-20-gd90f9cee')
  })

  it("is this opening's again once its text is changed: a new message with a new key", async () => {
    sendFeedback.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const { wrapper, router } = await render('/money')
    const sheet = await open(wrapper, { from: 'error', code: 'error.internal' })
    await type(sheet, 'The list did not load')
    await press(sheet)
    useFeedbackSheetStore().shown = false
    await flushPromises()
    await router.push('/settings')
    await open(wrapper)

    await type(sheet, 'The list did not load, and now the settings')

    expect(attached(sheet)).toContain('screen “Settings”')
    expect(attached(sheet)).not.toContain('code')
    await press(sheet)
    const [first, second] = sendFeedback.mock.calls.map(([body]) => body)
    expect(second?.clientKey).not.toBe(first?.clientKey)
    expect(second).toMatchObject({ route: 'settings', fromError: false, errorCode: null })
  })
})

describe('another window of the app with the same draft (round 5, Т1)', () => {
  const theirs = {
    locale: 'en',
    pageBuild: null,
    route: 'advice',
    platform: 'android browser',
    fromError: true,
    errorCode: 'error.internal',
  } as const

  async function drafted() {
    const { wrapper } = await render('/settings')
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.bug)
    await type(sheet, 'The list did not load')
    const draft = recallFeedbackDraft(OWNER)
    if (draft === null) throw new Error('no draft')
    return { sheet, draft }
  }

  it('sends what the other window sent under the key, not its own opening', async () => {
    const { sheet, draft } = await drafted()
    // The other window sent it from an error screen, and the answer was lost.
    localStorage.setItem(
      `molvia.feedback-draft.${OWNER}`,
      JSON.stringify({ ...draft, attached: theirs }),
    )

    await press(sheet)

    expect(sendFeedback.mock.calls[0]?.[0]).toMatchObject({ ...theirs, clientKey: draft.clientKey })
  })

  it("says sent without sending when the other window's send of it reached the owner (round 6, У1)", async () => {
    const { sheet, draft } = await drafted()
    localStorage.setItem(
      `molvia.feedback-draft.${OWNER}`,
      JSON.stringify({ sent: [draft.clientKey] }),
    )

    await press(sheet)

    expect(sendFeedback).not.toHaveBeenCalled()
    expect(sheet.find('.sent').exists()).toBe(true)
  })

  it('still knows it sent when the window that sent it has begun a new draft since (review 6)', async () => {
    const { sheet, draft } = await drafted()
    // The other window sent this draft, then began another message.
    localStorage.setItem(
      `molvia.feedback-draft.${OWNER}`,
      JSON.stringify({ sent: [draft.clientKey] }),
    )
    keepFeedbackDraft(OWNER, {
      kind: 'idea',
      text: 'Another thought',
      clientKey: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
    })

    await press(sheet)

    expect(sendFeedback).not.toHaveBeenCalled()
    expect(sheet.find('.sent').exists()).toBe(true)
    expect(recallFeedbackDraft(OWNER)?.text).toBe('Another thought')
  })

  it('must not take a message sent under another key for this one', async () => {
    const { sheet } = await drafted()
    localStorage.setItem(
      `molvia.feedback-draft.${OWNER}`,
      JSON.stringify({ sent: ['7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'] }),
    )

    await press(sheet)

    expect(sendFeedback).toHaveBeenCalledOnce()
  })

  it('must not take what was sent under another key: that is another message', async () => {
    const { sheet, draft } = await drafted()
    localStorage.setItem(
      `molvia.feedback-draft.${OWNER}`,
      JSON.stringify({
        ...draft,
        clientKey: '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
        attached: theirs,
      }),
    )

    await press(sheet)

    expect(sendFeedback.mock.calls[0]?.[0]).toMatchObject({
      route: 'settings',
      fromError: false,
      clientKey: draft.clientKey,
    })
  })
})

describe("a refusal in the API's own words: nothing left (adversarial Н2)", () => {
  it('lets go of what went with it, so the next opening attaches its own', async () => {
    sendFeedback.mockRejectedValueOnce(new ApiError(ERROR.FEEDBACK_RATE_LIMITED))
    const { wrapper, router } = await render('/money', 'v0.1.3-20-gd90f9cee')
    const sheet = await open(wrapper, { from: 'error', code: 'error.internal' })
    await type(sheet, 'The month did not load')
    await press(sheet)
    expect(recallFeedbackDraft(OWNER)?.attached).toBeUndefined()
    useFeedbackSheetStore().shown = false
    await flushPromises()

    await router.push('/settings')
    await open(wrapper)

    expect(sheet.get('h2').text()).toBe(en.feedback.title)
    expect(attached(sheet)).toContain('screen “Settings”')
    expect(attached(sheet)).not.toContain('code')
    await press(sheet)
    expect(sendFeedback.mock.calls[1]?.[0]).toMatchObject({
      route: 'settings',
      fromError: false,
      errorCode: null,
    })
  })

  it('takes a 2xx whose body did not read for sent: the message is written (round 3, Ф1)', async () => {
    sendFeedback.mockRejectedValueOnce(new ApiError(ISSUE.RESPONSE_INVALID, 'number', true, 201))
    const { wrapper } = await render('/money')
    const sheet = await open(wrapper, { from: 'error', code: 'error.internal' })
    await type(sheet, 'The month did not load')

    await press(sheet)

    expect(sheet.find('.sent').exists()).toBe(true)
    expect(recallFeedbackDraft(OWNER)).toBeNull()
  })

  it("must not take a portal's 200 page for sent: the draft stays, and the retry is the same message (round 4, П1)", async () => {
    sendFeedback.mockRejectedValueOnce(new ApiError(ISSUE.RESPONSE_INVALID, undefined, true, 200))
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.idea)
    await type(sheet, 'Typed for ten minutes')

    await press(sheet)

    expect(sheet.find('.sent').exists()).toBe(false)
    expect(sheet.get('.note').text()).toContain(en.feedback.failed.title)
    expect(recallFeedbackDraft(OWNER)?.text).toBe('Typed for ten minutes')
    await press(sheet)
    const [first, again] = sendFeedback.mock.calls.map(([body]) => body)
    expect(again).toEqual(first)
  })

  it('must not let go after a 401 that follows a lost answer: the row may be there (round 4, П3)', async () => {
    sendFeedback
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new ApiError(ERROR.NO_ACTOR))
    const { wrapper } = await render('/money')
    const sheet = await open(wrapper, { from: 'error', code: 'error.internal' })
    await type(sheet, 'The month did not load')

    await press(sheet)
    await press(sheet)

    expect(recallFeedbackDraft(OWNER)?.attached).toMatchObject({
      route: 'money',
      errorCode: 'error.internal',
    })
  })

  it('must not let go after the server failing in its own words: it may be written', async () => {
    sendFeedback.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL))
    const { wrapper } = await render('/money')
    const sheet = await open(wrapper, { from: 'error', code: 'error.internal' })
    await type(sheet, 'The month did not load')

    await press(sheet)

    expect(recallFeedbackDraft(OWNER)?.attached).toMatchObject({ route: 'money' })
  })

  it("must not let go after an answer that never came: it may be the server's already", async () => {
    sendFeedback.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'Failed to fetch', false))
    const { wrapper } = await render('/money')
    const sheet = await open(wrapper, { from: 'error', code: 'error.internal' })
    await type(sheet, 'The month did not load')

    await press(sheet)

    expect(recallFeedbackDraft(OWNER)?.attached).toMatchObject({
      route: 'money',
      errorCode: 'error.internal',
    })
  })
})

describe('sending', () => {
  it('sends once however often it is pressed, the form held meanwhile', async () => {
    sendFeedback.mockReturnValue(new Promise(() => undefined))
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.idea)
    await type(sheet, 'Twice')

    await button(sheet).trigger('click')
    await button(sheet).trigger('click')
    await flushPromises()

    expect(sendFeedback).toHaveBeenCalledOnce()
    expect(button(sheet).text()).toBe(en.feedback.sending)
    expect(button(sheet).attributes('aria-busy')).toBe('true')
    expect(textarea(sheet).attributes('readonly')).toBeDefined()
    expect(sheet.get('fieldset').attributes('disabled')).toBeDefined()
  })

  it('offline waits with the text kept: no queue, and the strip says so, not in red', async () => {
    online(false)
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.idea)
    await type(sheet, 'Written at the shelf')

    expect(sheet.get('.offline').text()).toBe(en.feedback.offline)
    expect(sheet.get('.offline').attributes('role')).toBe('status')
    expect(button(sheet).text()).toBe(en.feedback.need_network)
    await press(sheet)
    expect(sendFeedback).not.toHaveBeenCalled()

    online(true)
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(sheet.get('.offline').text()).toBe('')
    expect(button(sheet).text()).toBe(en.feedback.send)
  })

  it('says the answer through a region there from the opening, not one born with its words (№3)', async () => {
    sendFeedback.mockRejectedValueOnce(new ApiError(ERROR.FEEDBACK_RATE_LIMITED))
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    const region = sheet.get('.spoken')
    expect(region.attributes('role')).toBe('status')
    expect(region.text()).toBe('')
    await choose(sheet, en.feedback.kinds.idea)
    await type(sheet, 'The eleventh')

    await press(sheet)

    expect(sheet.get('.spoken').element).toBe(region.element)
    expect(region.text()).toBe(`${en.feedback.limit.title}. ${en.feedback.limit.body}`)
    expect(sheet.get('.note').attributes('role')).toBeUndefined()
  })

  it("keeps the text past the day's limit, and the next opening asks the server again", async () => {
    sendFeedback.mockRejectedValueOnce(new ApiError(ERROR.FEEDBACK_RATE_LIMITED))
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.idea)
    await type(sheet, 'The eleventh')

    await press(sheet)

    expect(sheet.get('.note').text()).toContain(en.feedback.limit.title)
    expect(button(sheet).text()).toBe(en.feedback.need_tomorrow)
    expect(textarea(sheet).element.value).toBe('The eleventh')
    // An edit does not lift it: the window is the server's.
    await type(sheet, 'The eleventh, amended')
    expect(button(sheet).text()).toBe(en.feedback.need_tomorrow)

    useFeedbackSheetStore().shown = false
    await flushPromises()
    await open(wrapper)
    expect(sheet.find('.note').exists()).toBe(false)
    expect(button(sheet).text()).toBe(en.feedback.send)
  })

  it('says a failure out loud, keeps the text, and retries the same message', async () => {
    sendFeedback.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL))
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.bug)
    await type(sheet, 'It broke')

    await press(sheet)

    expect(sheet.get('.note').attributes('role')).toBe('alert')
    expect(sheet.get('.note').text()).toContain(en.feedback.failed.title)
    expect(button(sheet).text()).toBe(en.state.retry)
    expect(textarea(sheet).element.value).toBe('It broke')

    await press(sheet)
    const [first, second] = sendFeedback.mock.calls.map(([body]) => body.clientKey)
    expect(second).toBe(first)
    expect(sheet.find('.sent').exists()).toBe(true)
  })

  it('takes the failure back once the text is changed', async () => {
    sendFeedback.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL))
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.bug)
    await type(sheet, 'It broke')
    await press(sheet)

    await type(sheet, 'It broke again')

    expect(sheet.find('.note').exists()).toBe(false)
    expect(button(sheet).text()).toBe(en.feedback.send)
  })

  it('takes a new key after a 409, so «Try again» cannot meet it for ever (сверка С-9)', async () => {
    sendFeedback.mockRejectedValueOnce(new ApiError(ERROR.CONFLICT))
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.bug)
    await type(sheet, 'It broke')

    await press(sheet)
    await press(sheet)

    const [first, second] = sendFeedback.mock.calls.map(([body]) => body.clientKey)
    expect(second).not.toBe(first)
  })

  it('says a character that cannot be sent under the field, and sends nothing', async () => {
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.bug)
    await type(sheet, `Broken ${String.fromCodePoint(0xe000)}`)

    await press(sheet)

    expect(sendFeedback).not.toHaveBeenCalled()
    expect(sheet.text()).toContain(en.feedback.unsupported)
    await type(sheet, 'Broken')
    expect(sheet.text()).not.toContain(en.feedback.unsupported)
  })

  it('takes no more than the bound, and counts the last of it', async () => {
    const { wrapper } = await render()
    const sheet = await open(wrapper)

    expect(textarea(sheet).attributes('maxlength')).toBe(String(FEEDBACK_TEXT_MAX))
    await type(sheet, 'a'.repeat(FEEDBACK_TEXT_MAX - 134))
    expect(sheet.get('.counter').text()).toBe('134 characters left')
  })
})

describe('the word «отзыв», «review»', () => {
  it('is used for it nowhere — neither on the sheet nor in its words', async () => {
    const words = (dictionary: typeof en) =>
      JSON.stringify([dictionary.feedback, dictionary.settings.feedback, dictionary.state.report])
    expect(words(en).toLowerCase()).not.toContain('review')
    expect(words(ru).toLowerCase()).not.toContain('отзыв')
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    expect(sheet.text().toLowerCase()).not.toContain('review')
  })
})

describe('a screenshot with the message (MOL-167)', () => {
  const screenshot = (bytes: string) => new File([bytes], 'shot.png', { type: 'image/png' })
  const base64 = (bytes: string) => btoa(bytes)
  const tiles = (sheet: VueWrapper) => sheet.findAll('.picture-tile img')
  const note = (sheet: VueWrapper) => sheet.find('.picture-note')

  async function attachFiles(sheet: VueWrapper, ...files: File[]): Promise<void> {
    const input = sheet.get<HTMLInputElement>('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: files, configurable: true })
    await input.trigger('change')
    await flushPromises()
  }

  it('shows the drawing, says «1 picture» with the rest, and sends it with a new key', async () => {
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.bug)
    await type(sheet, 'The button does nothing')
    const keyBefore = recallFeedbackDraft(OWNER)?.clientKey

    await attachFiles(sheet, screenshot('one'))

    expect(tiles(sheet)).toHaveLength(1)
    expect(tiles(sheet)[0]?.attributes('alt')).toBe('Picture 1')
    expect(attached(sheet)).toContain('1 picture ·')
    expect(recallFeedbackDraft(OWNER)).toMatchObject({ pictures: 1 })
    expect(recallFeedbackDraft(OWNER)?.clientKey).not.toBe(keyBefore)
    await press(sheet)
    expect(sendFeedback.mock.calls[0]?.[0]).toMatchObject({
      text: 'The button does nothing',
      pictures: [base64('one')],
    })
  })

  it('goes with a picture alone: no words asked for, and no text in the body (В-3)', async () => {
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.bug)
    expect(button(sheet).text()).toBe(en.feedback.need_text)

    await attachFiles(sheet, screenshot('alone'))
    expect(button(sheet).text()).toBe(en.feedback.send)
    await type(sheet, '   ')
    await press(sheet)

    const body = sendFeedback.mock.calls[0]?.[0]
    expect(body?.pictures).toEqual([base64('alone')])
    expect(body?.text).toBeUndefined()
    expect(JSON.parse(JSON.stringify(body))).not.toHaveProperty('text')
  })

  it('takes three at most: the fourth file chosen is left, and «Attach» goes', async () => {
    const { wrapper } = await render()
    const sheet = await open(wrapper)

    await attachFiles(sheet, screenshot('1'), screenshot('2'))
    await attachFiles(sheet, screenshot('3'), screenshot('4'))

    expect(tiles(sheet)).toHaveLength(3)
    expect(drawPicture).toHaveBeenCalledTimes(3)
    expect(sheet.find('input[type="file"]').exists()).toBe(false)
  })

  it('takes one away with «Remove», under a new key; the rest keep their order', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.bug)
    await attachFiles(sheet, screenshot('a'), screenshot('b'))
    const key = recallFeedbackDraft(OWNER)?.clientKey

    await sheet.get('button[aria-label="Remove picture 1"]').trigger('click')

    expect(tiles(sheet)).toHaveLength(1)
    expect(revoke).toHaveBeenCalledOnce()
    expect(recallFeedbackDraft(OWNER)?.clientKey).not.toBe(key)
    await press(sheet)
    expect(sendFeedback.mock.calls[0]?.[0].pictures).toEqual([base64('b')])
  })

  // MOL-222, В-2: a receipt's photos come with the opening, drawn anew and seen like a picture chosen
  it('takes a receipt’s photos as pictures: drawn anew, shown, removable, sent with the words', async () => {
    const { wrapper } = await render('/purchases')
    const photos = ['one', 'two', 'three', 'four'].map(
      (bytes) => new Blob([bytes], { type: 'image/jpeg' }),
    )
    useFeedbackSheetStore().open({ from: 'receipt' }, photos)
    await flushPromises()
    clock += 1000
    await new Promise((resolve) => setTimeout(resolve, 120))
    const sheet = wrapper
    // three at most: what a message carries (В-2 of MOL-167) — and the fourth is said (MOL-222, review 6)
    expect(tiles(sheet)).toHaveLength(3)
    expect(note(sheet).text()).toBe(
      '3 of 4 fit — a message takes three pictures at most. Remove one to attach another',
    )
    expect(drawPicture).toHaveBeenCalledTimes(3)
    // handed over once: the next opening brings none
    expect(useFeedbackSheetStore().takePhotos()).toEqual([])
    await sheet.get('.picture-remove').trigger('click')
    await flushPromises()
    expect(tiles(sheet)).toHaveLength(2)
    await choose(sheet, en.feedback.kinds.other)
    await press(sheet)
    expect(sendFeedback.mock.calls[0]?.[0]).toMatchObject({
      pictures: [base64('two'), base64('three')],
    })
  })

  it('says why a picture did not go in, and keeps the others', async () => {
    const { PictureRefused } = await import('@/feedbackPicture')
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await attachFiles(sheet, screenshot('fine'))

    drawPicture.mockRejectedValueOnce(new PictureRefused('shape'))
    await attachFiles(sheet, screenshot('long'))
    expect(note(sheet).text()).toBe(en.feedback.picture.shape)
    drawPicture.mockRejectedValueOnce(new PictureRefused('unreadable'))
    await attachFiles(sheet, screenshot('heic'))
    expect(note(sheet).text()).toBe(en.feedback.picture.unreadable)
    expect(tiles(sheet)).toHaveLength(1)
  })

  it('says a picture the API refused under the pictures, not as a failure of the message', async () => {
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.bug)
    await attachFiles(sheet, screenshot('x'))

    sendFeedback.mockRejectedValueOnce(new ApiError(ERROR.FEEDBACK_PICTURE_INVALID))
    await press(sheet)
    expect(note(sheet).text()).toBe(en.error.feedback_picture_invalid)
    expect(sheet.find('.note.bad').exists()).toBe(false)
    expect(button(sheet).text()).toBe(en.feedback.send)

    sendFeedback.mockRejectedValueOnce(new ApiError(ERROR.FEEDBACK_PICTURE_TOO_LARGE))
    await press(sheet)
    expect(note(sheet).text()).toBe(en.error.feedback_picture_too_large)
  })

  it('says the pictures were not kept after a reload, and leaves the key alone (review 7)', async () => {
    const key = '0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5d'
    keepFeedbackDraft(OWNER, { kind: 'bug', text: 'Look', clientKey: key, pictures: 2 })
    const { wrapper } = await render()
    const sheet = await open(wrapper)

    expect(note(sheet).text()).toBe(en.feedback.picture.lost)
    expect(textarea(sheet).element.value).toBe('Look')
    expect(recallFeedbackDraft(OWNER)?.clientKey).toBe(key)
    // The window that holds them sends under that key, and the draft goes with it.
    dropFeedbackDraft(OWNER, key)
    expect(recallFeedbackDraft(OWNER)).toBeNull()
    // Anything done here is another content, under a key of its own.
    await type(sheet, 'Look again')
    expect(recallFeedbackDraft(OWNER)?.clientKey).not.toBe(key)
  })

  it('lets the pictures go once sent, the sheet closed meanwhile (adversarial А1)', async () => {
    let answer: (value: { sent: FeedbackSent; created: boolean }) => void = () => undefined
    sendFeedback.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.bug)
    await attachFiles(sheet, screenshot('with my balance on it'))
    await button(sheet).trigger('click')
    useFeedbackSheetStore().shown = false
    await flushPromises()

    answer({ sent: { number: 42 }, created: true })
    await flushPromises()
    await open(sheet)

    expect(tiles(sheet)).toHaveLength(0)
    await choose(sheet, en.feedback.kinds.idea)
    expect(button(sheet).text()).toBe(en.feedback.need_text)
  })

  it('keeps pictures changed while the first message was on its way: they are another message', async () => {
    let answer: (value: { sent: FeedbackSent; created: boolean }) => void = () => undefined
    sendFeedback.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.bug)
    await attachFiles(sheet, screenshot('first'))
    await button(sheet).trigger('click')
    useFeedbackSheetStore().shown = false
    await flushPromises()
    await open(sheet)
    await attachFiles(sheet, screenshot('second'))

    answer({ sent: { number: 42 }, created: true })
    await flushPromises()

    expect(tiles(sheet)).toHaveLength(2)
  })

  it('keeps the pictures of a message whose words changed while it was on its way (adversarial Б2)', async () => {
    let answer: (value: { sent: FeedbackSent; created: boolean }) => void = () => undefined
    sendFeedback.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.bug)
    await type(sheet, 'Broken')
    await attachFiles(sheet, screenshot('kept'))
    await button(sheet).trigger('click')
    useFeedbackSheetStore().shown = false
    await flushPromises()
    await open(sheet)
    await type(sheet, 'Broken, and one more thing')

    answer({ sent: { number: 42 }, created: true })
    await flushPromises()

    // Another message now, by its key: its pictures stay where the finger left them, nothing said.
    expect(tiles(sheet)).toHaveLength(1)
    expect(note(sheet).exists()).toBe(false)
    expect(recallFeedbackDraft(OWNER)).toMatchObject({ pictures: 1 })
  })

  describe('a draft that began to leave with pictures this page lost (adversarial Б3, В2)', () => {
    const key = '0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5d'
    const leaving = () => {
      keepFeedbackDraft(OWNER, {
        kind: 'bug',
        text: 'Look',
        clientKey: key,
        pictures: 1,
        attached: {
          locale: 'en',
          pageBuild: null,
          route: 'settings',
          platform: 'ios 18 app',
          fromError: false,
          errorCode: null,
        },
      })
    }

    it('keeps its key at the opening: the window sending it drops the draft (В2)', async () => {
      leaving()
      const { wrapper } = await render()
      const sheet = await open(wrapper)

      expect(note(sheet).text()).toBe(en.feedback.picture.lost)
      expect(recallFeedbackDraft(OWNER)?.clientKey).toBe(key)
      dropFeedbackDraft(OWNER, key)
      expect(recallFeedbackDraft(OWNER)).toBeNull()
    })

    it('takes a 409 under that key for sent: the server holds it, pictures and all (Б3)', async () => {
      leaving()
      sendFeedback.mockRejectedValueOnce(new ApiError(ERROR.CONFLICT))
      const { wrapper } = await render()
      const sheet = await open(wrapper)

      await press(sheet)

      expect(sendFeedback.mock.calls[0]?.[0].clientKey).toBe(key)
      expect(sheet.find('.sent').exists()).toBe(true)
      expect(sheet.find('.note.bad').exists()).toBe(false)
      expect(recallFeedbackDraft(OWNER)).toBeNull()
      expect(sendFeedback).toHaveBeenCalledOnce()
    })

    it("control: changed since, a 409 is the phone's own defect again — a new key and «Try again»", async () => {
      leaving()
      sendFeedback.mockRejectedValueOnce(new ApiError(ERROR.CONFLICT))
      const { wrapper } = await render()
      const sheet = await open(wrapper)
      await type(sheet, 'Look again')
      const typed = recallFeedbackDraft(OWNER)?.clientKey

      await press(sheet)

      expect(sheet.find('.note.bad').exists()).toBe(true)
      expect(recallFeedbackDraft(OWNER)?.clientKey).not.toBe(typed)
    })
  })

  it('says sent in the opening it came to, the sheet closed and opened untouched (adversarial В1)', async () => {
    let answer: (value: { sent: FeedbackSent; created: boolean }) => void = () => undefined
    sendFeedback.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.bug)
    await type(sheet, 'Broken')
    await attachFiles(sheet, screenshot('shown'))
    await button(sheet).trigger('click')
    useFeedbackSheetStore().shown = false
    await flushPromises()
    await open(sheet)

    answer({ sent: { number: 42 }, created: true })
    await flushPromises()

    expect(sheet.find('.sent').exists()).toBe(true)
    expect(button(sheet).text()).toBe(en.feedback.done)
  })

  it('tries every file chosen: one the browser cannot open does not keep the next (adversarial А6)', async () => {
    const { PictureRefused } = await import('@/feedbackPicture')
    drawPicture
      .mockImplementationOnce((file) =>
        Promise.resolve({ jpeg: new Blob([file]), width: 1179, height: 2556 }),
      )
      .mockRejectedValueOnce(new PictureRefused('unreadable'))
    const { wrapper } = await render()
    const sheet = await open(wrapper)

    await attachFiles(sheet, screenshot('one'), screenshot('heic'), screenshot('three'))

    expect(drawPicture).toHaveBeenCalledTimes(3)
    expect(tiles(sheet)).toHaveLength(2)
    expect(note(sheet).text()).toBe(en.feedback.picture.unreadable)
  })

  it('takes a text that draws nothing beside a picture for no text: the picture goes (review 5)', async () => {
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.bug)
    await attachFiles(sheet, screenshot('alone'))

    await type(sheet, '\u2060 \u200b')
    expect(button(sheet).text()).toBe(en.feedback.send)
    await press(sheet)

    expect(sendFeedback).toHaveBeenCalledOnce()
    expect(sendFeedback.mock.calls[0]?.[0].text).toBeUndefined()
    expect(sheet.text()).not.toContain(en.feedback.unsupported)
  })

  it('lets the pictures go once sent', async () => {
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.idea)
    await attachFiles(sheet, screenshot('sent'))

    await press(sheet)
    expect(sheet.find('.sent').exists()).toBe(true)
    await press(sheet)
    await open(sheet)

    expect(tiles(sheet)).toHaveLength(0)
    expect(sheet.find('.picture-hint').exists()).toBe(true)
  })

  it('waits while a picture is being drawn', async () => {
    let finish: (value: { jpeg: Blob; width: number; height: number }) => void = () => undefined
    drawPicture.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const { wrapper } = await render()
    const sheet = await open(wrapper)
    await choose(sheet, en.feedback.kinds.bug)

    await attachFiles(sheet, screenshot('slow'))
    expect(button(sheet).text()).toBe(en.feedback.picture.adding)
    expect(sheet.get('.picture-add').attributes('aria-busy')).toBe('true')

    finish({ jpeg: new Blob(['slow']), width: 100, height: 200 })
    await flushPromises()
    expect(button(sheet).text()).toBe(en.feedback.send)
  })
})
