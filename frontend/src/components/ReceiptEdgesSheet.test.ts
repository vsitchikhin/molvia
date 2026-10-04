import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ReceiptEdgesSheet from '@/components/ReceiptEdgesSheet.vue'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import type { Quad } from '@/receipts/warp'

// No canvas in happy-dom: the geometry is `warp.test.ts`'s, the pixels end-to-end's.
const proposeCorners = vi.fn<(photo: HTMLCanvasElement) => { quad: Quad; found: boolean }>()
const straighten =
  vi.fn<(photo: HTMLCanvasElement, quad: Quad) => Promise<HTMLCanvasElement | null>>()
const turnedPhoto = vi.fn<(photo: HTMLCanvasElement) => HTMLCanvasElement | null>()
vi.mock('@/receipts/straighten', async (actual) => ({
  ...(await actual<typeof import('@/receipts/straighten')>()),
  proposeCorners: (photo: HTMLCanvasElement) => proposeCorners(photo),
  straighten: (photo: HTMLCanvasElement, quad: Quad) => straighten(photo, quad),
  turnedPhoto: (photo: HTMLCanvasElement) => turnedPhoto(photo),
}))

const QUAD: Quad = [
  { x: 100, y: 50 },
  { x: 500, y: 60 },
  { x: 490, y: 1500 },
  { x: 110, y: 1490 },
]

function canvas(width: number, height: number): HTMLCanvasElement {
  const one = document.createElement('canvas')
  one.width = width
  one.height = height
  return one
}

const mounted: VueWrapper[] = []
// The sheet's own clock: «up» is a moment, and a tap is judged against it (MOL-69).
let clock = 0
const dialog = () => document.body.querySelector('dialog[open]')
const buttons = () => [...(dialog()?.querySelectorAll('button') ?? [])]
const press = async (text: string) => {
  const found = buttons().find((node) => node.textContent.includes(text))
  if (!found) throw new Error(`нет кнопки «${text}»`)
  // a finger comes after the button is drawn: Vue drops an event that is not later than its
  // listener by `Date.now()` — a button the last press put there is pressed a moment after it
  clock += 10
  await new Promise((resolve) => setTimeout(resolve, 5))
  found.click()
  await flushPromises()
}

async function render(source = canvas(600, 1600)) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/purchases')
  const view = mount(ReceiptEdgesSheet, {
    props: { open: true, source, part: 2 },
    global: { plugins: [router, pinia, createAppI18n('ru')] },
    attachTo: document.body,
  })
  mounted.push(view)
  await flushPromises()
  // the sheet takes no tap until it has come up (MOL-69)
  clock += 1000
  await flushPromises()
  return view
}

describe('ReceiptEdgesSheet (MOL-222): «Края чека»', () => {
  beforeEach(() => {
    clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    proposeCorners.mockReset()
    proposeCorners.mockReturnValue({ quad: QUAD, found: true })
    straighten.mockReset()
    straighten.mockResolvedValue(canvas(800, 2400))
    turnedPhoto.mockReset()
    turnedPhoto.mockImplementation((photo) => canvas(photo.height, photo.width))
  })

  afterEach(() => {
    for (const view of mounted.splice(0)) view.unmount()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('opens on the corners the phone proposed, part number and hint', async () => {
    await render()
    expect(dialog()?.textContent).toContain(ru.receipt.edges.title)
    expect(dialog()?.textContent).toContain('Часть 2')
    expect(dialog()?.textContent).toContain(ru.receipt.edges.hint)
    const handles = dialog()?.querySelectorAll<HTMLElement>('.handle') ?? []
    expect(handles).toHaveLength(4)
    // 100 of 600 across, 50 of 1600 down
    expect(handles[0]?.style.left).toMatch(/^16\.66/)
    expect(handles[0]?.style.top).toBe('3.125%')
  })

  it('says so when it found no edges: the corners are the photo’s own', async () => {
    proposeCorners.mockReturnValue({
      quad: [
        { x: 0, y: 0 },
        { x: 600, y: 0 },
        { x: 600, y: 1600 },
        { x: 0, y: 1600 },
      ],
      found: false,
    })
    await render()
    expect(dialog()?.textContent).toContain(ru.receipt.edges.not_found)
  })

  it('«Готово» straightens by the corners and hands the receipt on', async () => {
    const view = await render()
    await press(ru.receipt.edges.done)
    expect(straighten).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), QUAD)
    expect(view.emitted('done')).toHaveLength(1)
  })

  it('a receipt narrower than a till’s grid asks first: «Оставить так» hands it on', async () => {
    straighten.mockResolvedValue(canvas(500, 2400))
    const view = await render()
    await press(ru.receipt.edges.done)
    expect(view.emitted('done')).toBeUndefined()
    expect(dialog()?.textContent).toContain(ru.receipt.edges.narrow)
    await press(ru.receipt.edges.keep)
    expect(view.emitted('done')).toHaveLength(1)
  })

  it('«Подойти ближе» drops this shot and asks for the camera, sending nothing', async () => {
    straighten.mockResolvedValue(canvas(500, 2400))
    const view = await render()
    await press(ru.receipt.edges.done)
    await press(ru.receipt.edges.closer)
    expect(view.emitted('closer')).toHaveLength(1)
    expect(view.emitted('done')).toBeUndefined()
  })

  it('a corner moved after «Чек мелкий» asks again: the warning was of the old corners', async () => {
    straighten.mockResolvedValue(canvas(500, 2400))
    await render()
    await press(ru.receipt.edges.done)
    const handle = dialog()?.querySelector<HTMLElement>('.handle')
    handle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    await flushPromises()
    expect(dialog()?.textContent).not.toContain(ru.receipt.edges.narrow)
    expect(dialog()?.textContent).toContain(ru.receipt.edges.done)
  })

  it('an arrow moves a corner by a step, and stops at the photo’s edge', async () => {
    proposeCorners.mockReturnValue({
      quad: [
        { x: 2, y: 50 },
        { x: 500, y: 60 },
        { x: 490, y: 1500 },
        { x: 110, y: 1490 },
      ],
      found: true,
    })
    const view = await render()
    const handle = dialog()?.querySelector<HTMLElement>('.handle')
    handle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    await flushPromises()
    expect(handle?.style.left).toBe('0%')
    await press(ru.receipt.edges.done)
    expect(straighten.mock.calls[0]?.[1][0]).toEqual({ x: 0, y: 50 })
    expect(view.emitted('done')).toHaveLength(1)
  })

  it('«Повернуть» turns the photo a quarter and the corners with it', async () => {
    await render()
    await press(ru.receipt.edges.turn)
    expect(turnedPhoto).toHaveBeenCalledTimes(1)
    await press(ru.receipt.edges.done)
    const [photo, corners] = straighten.mock.calls[0] ?? []
    expect([photo?.width, photo?.height]).toEqual([1600, 600])
    // the receipt's left edge, x ≈ 100, is its top now: 1600 − y of the old corners, the old x
    expect(corners?.[0]).toEqual({ x: 110, y: 110 })
  })

  it('a photo that cannot be straightened is given up, said by the opener', async () => {
    straighten.mockResolvedValue(null)
    const view = await render()
    await press(ru.receipt.edges.done)
    expect(view.emitted('failed')).toHaveLength(1)
    expect(view.emitted('done')).toBeUndefined()
  })

  it('«‹» takes the shot away: nothing is handed on', async () => {
    const view = await render()
    const back = buttons().find((node) => node.getAttribute('aria-label')?.includes('Назад'))
    back?.click()
    await flushPromises()
    expect(view.emitted('done')).toBeUndefined()
    expect(view.emitted('update:open')?.[0]).toEqual([false])
  })
})
