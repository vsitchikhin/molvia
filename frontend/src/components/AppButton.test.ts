import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import AppButton from '@/components/AppButton.vue'
import type { ButtonVariant } from '@/components/AppButton.vue'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AppButton', () => {
  it.each<ButtonVariant>(['primary', 'secondary', 'tinted', 'ghost', 'danger-ghost'])(
    'draws the %s look',
    (variant) => {
      const view = mount(AppButton, { props: { variant }, slots: { default: 'Go' } })
      expect(view.classes()).toContain(variant)
      expect(view.text()).toBe('Go')
    },
  )

  it('is the primary action unless told otherwise', () => {
    expect(mount(AppButton).classes()).toContain('primary')
  })

  // Inside a <form> the browser's default type submits it: «Не сейчас» would send the rating.
  it('does not submit the form it sits in', async () => {
    const submitted = vi.fn((event: Event) => {
      event.preventDefault()
    })
    const view = mount({
      render: () => h('form', { onSubmit: submitted }, [h(AppButton, null, () => 'Later')]),
    })
    expect(view.get('button').attributes('type')).toBe('button')
    await view.get('button').trigger('click')
    expect(submitted).not.toHaveBeenCalled()
  })

  it('submits when it is asked to', () => {
    const view = mount(AppButton, { props: { type: 'submit' } })
    expect(view.attributes('type')).toBe('submit')
  })

  it('names an icon-only button by its label and hides the icon from a screen reader', () => {
    const view = mount(AppButton, {
      props: { variant: 'icon', label: 'Close' },
      slots: { default: '<svg class="x"></svg>' },
    })
    expect(view.attributes('aria-label')).toBe('Close')
    expect(view.get('.glyph').attributes('aria-hidden')).toBe('true')
    expect(view.find('.glyph svg').exists()).toBe(true)
  })

  it('warns when an icon-only button has nothing to name it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mount(AppButton, { props: { variant: 'icon' } })
    expect(warn).toHaveBeenCalledOnce()
  })

  // A label on a button with text would replace the text for voice control: «tap Save» would
  // find nothing to tap.
  it('must not fire: a button with text carries no aria-label', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const view = mount(AppButton, { slots: { default: 'Save' } })
    expect(view.attributes('aria-label')).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })

  it('puts an icon in front of the text, hidden from a screen reader', () => {
    const view = mount(AppButton, {
      props: { variant: 'ghost' },
      slots: { icon: '<svg></svg>', default: 'Add an item' },
    })
    const [glyph] = view.element.children
    expect(glyph?.classList.contains('glyph')).toBe(true)
    expect(glyph?.getAttribute('aria-hidden')).toBe('true')
    expect(view.text()).toBe('Add an item')
  })

  it('has no empty icon box when no icon is given', () => {
    expect(
      mount(AppButton, { slots: { default: 'Retry' } })
        .find('.glyph')
        .exists(),
    ).toBe(false)
  })

  it('grows to 52px and to the full width when asked', () => {
    const view = mount(AppButton, { props: { size: 'large', block: true } })
    expect(view.classes()).toEqual(expect.arrayContaining(['large', 'block']))
  })

  it('does not pass a click through when disabled', async () => {
    const clicked = vi.fn()
    const view = mount(AppButton, { props: { disabled: true }, attrs: { onClick: clicked } })
    await view.trigger('click')
    expect(view.attributes('disabled')).toBeDefined()
    expect(clicked).not.toHaveBeenCalled()
  })
})

it.each(['busy', 'inactive'] as const)(
  'keeps %s buttons focusable but suppresses clicks and submission',
  async (state) => {
    const clicked = vi.fn()
    const above = vi.fn()
    const host = document.createElement('div')
    host.addEventListener('click', above)
    document.body.append(host)
    const view = mount(AppButton, {
      attachTo: host,
      props: { [state]: true, type: 'submit', onClick: clicked },
    })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    view.element.dispatchEvent(event)
    expect(view.attributes('disabled')).toBeUndefined()
    expect(view.attributes('aria-disabled')).toBe('true')
    expect(event.defaultPrevented).toBe(true)
    expect(clicked).not.toHaveBeenCalled()
    // A `disabled` button fires no click at all, and this one must reach no handler above it.
    expect(above).not.toHaveBeenCalled()
    await view.setProps({ [state]: false })
    await view.trigger('click')
    expect(clicked).toHaveBeenCalledOnce()
  },
)

// MOL-225: busy is the button's own word. Both words stand in one cell, so the button keeps the
// width of the wider one; the one not shown is hidden from the eye and from a screen reader.
describe('AppButton at work', () => {
  // The word not shown at rest is drawn by CSS from `data-word`, so the text is the action's alone.
  const words = (view: ReturnType<typeof mount>) =>
    view.findAll('.words > span').map((word) => ({
      text: word.text() || (word.attributes('data-word') ?? ''),
      shown: !word.classes('unseen') && word.attributes('aria-hidden') === undefined,
    }))

  it('says the action while idle and keeps the word of the work by its width', () => {
    const view = mount(AppButton, {
      props: { busyLabel: 'Deleting…' },
      slots: { default: 'Delete for good' },
    })
    expect(words(view)).toEqual([
      { text: 'Delete for good', shown: true },
      { text: 'Deleting…', shown: false },
    ])
    expect(view.attributes('aria-busy')).toBeUndefined()
    expect(view.text()).toBe('Delete for good')
  })

  it('says the work while busy, in place of the action, and stays focusable', async () => {
    const view = mount(AppButton, {
      attachTo: document.body,
      props: { busyLabel: 'Deleting…' },
      slots: { icon: '<svg></svg>', default: 'Delete for good' },
    })
    view.element.focus()
    await view.setProps({ busy: true })
    expect(words(view)).toEqual([
      { text: 'Delete for good', shown: false },
      { text: 'Deleting…', shown: true },
    ])
    expect(view.attributes('aria-busy')).toBe('true')
    // The glyph stays: the form of the action is kept, it is not «not now».
    expect(view.find('.glyph').exists()).toBe(true)
    expect(document.activeElement).toBe(view.element)
    await view.setProps({ busy: false })
    expect(words(view).map((word) => word.shown)).toEqual([true, false])
    view.unmount()
  })

  it('keeps aria-busy with disabled, so the kit draws the work and not «not now»', () => {
    const view = mount(AppButton, {
      props: { busy: true, disabled: true, busyLabel: 'Saving…' },
      slots: { default: 'Save' },
    })
    expect(view.attributes('aria-busy')).toBe('true')
    expect(words(view)[1]).toEqual({ text: 'Saving…', shown: true })
  })

  it('names an icon-only button by the word of the work while busy', async () => {
    const view = mount(AppButton, {
      props: { variant: 'icon', label: 'Refresh', busyLabel: 'Refreshing…' },
      slots: { default: '<svg></svg>' },
    })
    expect(view.attributes('aria-label')).toBe('Refresh')
    await view.setProps({ busy: true })
    expect(view.attributes('aria-label')).toBe('Refreshing…')
  })

  it('swaps the word of a block button, which is as wide as its place', async () => {
    const view = mount(AppButton, {
      props: { block: true, busyLabel: 'Deleting…' },
      slots: { default: 'Delete for good' },
    })
    expect(view.find('.words').exists()).toBe(false)
    expect(view.text()).toBe('Delete for good')
    await view.setProps({ busy: true })
    expect(view.text()).toBe('Deleting…')
    await view.setProps({ busy: false })
    expect(view.text()).toBe('Delete for good')
  })

  // Not only an icon: a label overrides the text for a screen reader, so it is the label that says
  // the work (adversarial round 1, «не проверено»).
  it('names a labelled button with text by the word of the work while busy', async () => {
    const view = mount(AppButton, {
      props: { label: 'Record an exchange', busyLabel: 'Saving…' },
      slots: { default: 'Record' },
    })
    expect(view.attributes('aria-label')).toBe('Record an exchange')
    await view.setProps({ busy: true })
    expect(view.attributes('aria-label')).toBe('Saving…')
  })

  it('must not fire: a button with no word of work has no second cell', () => {
    const view = mount(AppButton, { slots: { default: 'Save' } })
    expect(view.find('.words').exists()).toBe(false)
    expect(view.text()).toBe('Save')
  })
})
