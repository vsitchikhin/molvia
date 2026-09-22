import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import AppButton from '@/components/AppButton.vue'
import type { ButtonVariant } from '@/components/AppButton.vue'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AppButton', () => {
  it.each<ButtonVariant>(['primary', 'secondary', 'ghost', 'danger-ghost'])(
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
    const view = mount(AppButton, { props: { [state]: true, type: 'submit', onClick: clicked } })
    const event = new MouseEvent('click', { cancelable: true })
    view.element.dispatchEvent(event)
    expect(view.attributes('disabled')).toBeUndefined()
    expect(view.attributes('aria-disabled')).toBe('true')
    expect(event.defaultPrevented).toBe(true)
    expect(clicked).not.toHaveBeenCalled()
    await view.setProps({ [state]: false })
    await view.trigger('click')
    expect(clicked).toHaveBeenCalledOnce()
  },
)
