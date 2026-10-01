import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import AppReveal from './AppReveal.vue'

/** Every animation the reveal asks for, finished when the test says so. */
function fakeAnimate() {
  const played: { element: HTMLElement; frames: Keyframe[]; finish: () => void }[] = []
  vi.spyOn(Element.prototype, 'animate').mockImplementation(function (
    this: Element,
    frames: Keyframe[] | PropertyIndexedKeyframes | null,
  ) {
    let finish: () => void = () => undefined
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    played.push({ element: this as HTMLElement, frames: frames as Keyframe[], finish })
    return { finished } as unknown as Animation
  })
  return played
}

function list(initial: string[]) {
  const rows = ref(initial)
  const view = mount(
    defineComponent(
      () => () =>
        h('ul', [
          h(AppReveal, { group: true }, () => rows.value.map((row) => h('li', { key: row }, row))),
        ]),
    ),
    {
      attachTo: document.body,
      global: { stubs: { transition: false, 'transition-group': false } },
    },
  )
  return { rows, view, items: () => view.findAll('li').map((item) => item.text()) }
}

function block(shown = false) {
  const on = ref(shown)
  const view = mount(
    defineComponent(
      () => () =>
        h('div', [h(AppReveal, null, () => (on.value ? [h('p', { key: 'p' }, 'Ошибка')] : []))]),
    ),
    {
      attachTo: document.body,
      global: { stubs: { transition: false, 'transition-group': false } },
    },
  )
  return { on, view }
}

/** Lets the render, the reveal's own microtask and an animation's end go by. */
async function settled() {
  await nextTick()
  await Promise.resolve()
  await Promise.resolve()
}

describe('AppReveal', () => {
  let motion = 'no-preference'

  beforeEach(() => {
    motion = 'no-preference'
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === `(prefers-reduced-motion: ${motion})`,
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete document.documentElement.dataset.nav
    document.body.innerHTML = ''
  })

  it('grows a row added from nothing', async () => {
    const played = fakeAnimate()
    const { rows } = list(['a', 'b'])
    rows.value = ['new', 'a', 'b']
    await settled()
    expect(played).toHaveLength(1)
    expect(played[0]?.element.textContent).toBe('new')
    expect(played[0]?.frames[0]).toMatchObject({ height: '0px', opacity: '0' })
    expect(played[0]?.frames[1]).toMatchObject({ opacity: '1' })
  })

  it('shrinks a row removed, and takes it away once it is gone', async () => {
    const played = fakeAnimate()
    const { rows, items } = list(['a', 'b', 'c'])
    rows.value = ['a', 'c']
    await settled()
    expect(played).toHaveLength(1)
    expect(played[0]?.frames[1]).toMatchObject({ height: '0px', opacity: '0' })
    expect(items()).toEqual(['a', 'b', 'c'])
    played[0]?.finish()
    await settled()
    expect(items()).toEqual(['a', 'c'])
  })

  // A day of «Деньги» is a row of the list and a child of the screen's block: grown, it does not also
  // fade in (adversarial round 2).
  it('cuts short the fade-in of a row it grows', async () => {
    fakeAnimate()
    const cancel = vi.fn()
    vi.spyOn(Element.prototype, 'getAnimations').mockReturnValue([
      { animationName: 'appear', cancel } as unknown as Animation,
    ])
    const { rows } = list(['a'])
    rows.value = ['new', 'a']
    await settled()
    expect(cancel).toHaveBeenCalledOnce()
  })

  // Going, it is no longer there: a second tap meant for the row sliding up under it pressed the
  // one going (review №4).
  it('takes no tap and no focus from a row going', async () => {
    const played = fakeAnimate()
    const { rows, view } = list(['a', 'b'])
    rows.value = ['b']
    await settled()
    expect(played).toHaveLength(1)
    expect((view.findAll('li')[0]?.element as HTMLElement).inert).toBe(true)
    expect((view.findAll('li')[1]?.element as HTMLElement).inert).toBe(false)
  })

  // The gap of a column is its parent's: taken back by the margin, or the neighbour jumps by it.
  it('takes back the gap of the column it grows in', async () => {
    const played = fakeAnimate()
    const { rows, view } = list(['a', 'b'])
    const column = view.find('ul').element as HTMLElement
    column.style.display = 'flex'
    column.style.flexDirection = 'column'
    column.style.rowGap = '12px'
    rows.value = ['a', 'b', 'last']
    await settled()
    const first = played.find((move) => move.element.textContent === 'last')
    expect(first?.frames[0]).toMatchObject({ marginTop: '-12px', marginBottom: '0px' })
  })

  it('takes back the gap below a row that has one after it', async () => {
    const played = fakeAnimate()
    const { rows, view } = list(['a', 'b'])
    const column = view.find('ul').element as HTMLElement
    column.style.display = 'flex'
    column.style.flexDirection = 'column'
    column.style.rowGap = '12px'
    rows.value = ['new', 'a', 'b']
    await settled()
    expect(played[0]?.frames[0]).toMatchObject({ marginTop: '0px', marginBottom: '-12px' })
  })

  it('must not fire: a list that is not a column keeps its margins', async () => {
    const played = fakeAnimate()
    const { rows } = list(['a', 'b'])
    rows.value = ['new', 'a', 'b']
    await settled()
    expect(played[0]?.frames[0]).toMatchObject({ marginTop: '0px', marginBottom: '0px' })
  })

  it('plays exactly three rows coming at once', async () => {
    const played = fakeAnimate()
    const { rows } = list(['a'])
    rows.value = ['x', 'y', 'z', 'a']
    await settled()
    expect(played).toHaveLength(3)
  })

  // A month read, a page: an answer, not a row added.
  it('must not fire: four rows coming at once just appear', async () => {
    const played = fakeAnimate()
    const { rows, items } = list(['a'])
    rows.value = ['w', 'x', 'y', 'z', 'a']
    await settled()
    expect(played).toHaveLength(0)
    expect(items()).toEqual(['w', 'x', 'y', 'z', 'a'])
  })

  it('must not fire: four rows going at once are just gone', async () => {
    const played = fakeAnimate()
    const { rows, items } = list(['w', 'x', 'y', 'z', 'a'])
    rows.value = ['a']
    await settled()
    expect(played).toHaveLength(0)
    expect(items()).toEqual(['a'])
  })

  it('must not fire: the first render', async () => {
    const played = fakeAnimate()
    list(['a', 'b'])
    await settled()
    expect(played).toHaveLength(0)
  })

  it('must not fire: «reduce motion»', async () => {
    motion = 'reduce'
    const played = fakeAnimate()
    const { rows, items } = list(['a'])
    rows.value = ['a', 'b']
    await settled()
    expect(played).toHaveLength(0)
    expect(items()).toEqual(['a', 'b'])
  })

  // The view transition brings the new screen in already.
  it('must not fire: while a screen moves', async () => {
    const played = fakeAnimate()
    const { rows } = list(['a'])
    document.documentElement.dataset.nav = 'push'
    rows.value = ['a', 'b']
    await settled()
    expect(played).toHaveLength(0)
  })

  it('grows a block shown and shrinks it hidden', async () => {
    const played = fakeAnimate()
    const { on, view } = block()
    on.value = true
    await settled()
    expect(played).toHaveLength(1)
    expect(view.find('p').exists()).toBe(true)
    played[0]?.finish()
    on.value = false
    await settled()
    expect(played).toHaveLength(2)
    expect(view.find('p').exists()).toBe(true)
    played[1]?.finish()
    await settled()
    expect(view.find('p').exists()).toBe(false)
  })

  it('gives the block its own overflow back once it has grown', async () => {
    const played = fakeAnimate()
    const { on, view } = block()
    on.value = true
    await settled()
    const paragraph = view.find('p').element as HTMLElement
    expect(paragraph.style.overflow).toBe('hidden')
    played[0]?.finish()
    await settled()
    expect(paragraph.style.overflow).toBe('')
  })
})
