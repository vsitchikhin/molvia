import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import type { VNode } from 'vue'
import { createAppI18n } from '@/i18n'
import SearchField from '@/components/SearchField.vue'

type Props = InstanceType<typeof SearchField>['$props']

interface Options {
  slots?: Record<string, () => VNode>
  attrs?: Record<string, unknown>
}

function render(props: Partial<Props> = {}, { slots = {}, attrs = {} }: Options = {}) {
  return mount(SearchField, {
    props: { modelValue: '', label: 'Search the catalogue', ...props },
    slots,
    attrs,
    attachTo: document.body,
    global: { plugins: [createAppI18n('en')] },
  })
}

describe('SearchField', () => {
  it('is a search box named by its label, a magnifier before it hidden from a screen reader', () => {
    const view = render({ placeholder: 'Milk, lavash, cheese…' })
    const input = view.get('input')
    expect(input.attributes('type')).toBe('search')
    expect(input.attributes('enterkeyhint')).toBe('search')
    expect(input.attributes('aria-label')).toBe('Search the catalogue')
    expect(input.attributes('placeholder')).toBe('Milk, lavash, cheese…')
    expect(view.get('.glyph').attributes('aria-hidden')).toBe('true')
    view.unmount()
  })

  it('sends what is typed', async () => {
    const view = render()
    await view.get('input').setValue('syr')
    expect(view.emitted('update:modelValue')).toEqual([['syr']])
    view.unmount()
  })

  describe('«Очистить»', () => {
    it('stands only while there is text, and only when the field is clearable', () => {
      for (const props of [{ clearable: true }, { modelValue: 'syr' }]) {
        const none = render(props)
        expect(none.find('.clear').exists()).toBe(false)
        none.unmount()
      }
      const view = render({ clearable: true, modelValue: 'syr' })
      expect(view.get('.clear').attributes('aria-label')).toBe('Clear')
      expect(view.get('.well').classes()).toContain('trailed')
      view.unmount()
    })

    it('empties the field and puts the focus back in it', async () => {
      const view = render({ clearable: true, modelValue: 'syr' })
      await view.get('.clear').trigger('click')
      expect(view.emitted('update:modelValue')).toEqual([['']])
      expect(document.activeElement).toBe(view.get('input').element)
      view.unmount()
    })

    // Nothing may be changed now — a code on its way to an item (MOL-100): the button would change it
    // all the same (adversarial А2).
    it('does not stand while the field is read-only', () => {
      const view = render({ clearable: true, readonly: true, modelValue: 'syr' })
      expect(view.find('.clear').exists()).toBe(false)
      expect(view.get('.well').classes()).not.toContain('trailed')
      view.unmount()
    })

    it('gives way to the screen’s own action at the right', () => {
      const view = render(
        { clearable: true, modelValue: 'syr' },
        { slots: { trailing: () => h('button', { class: 'scan' }, 'Scan') } },
      )
      expect(view.find('.clear').exists()).toBe(false)
      expect(view.get('.well .scan').text()).toBe('Scan')
      expect(view.get('.well').classes()).toContain('trailed')
      view.unmount()
    })
  })

  it('ties the hint to the input, and names none it was not given', () => {
    const view = render({ hint: 'Typos and Latin are fine' })
    const hint = view.get('.hint')
    expect(hint.text()).toBe('Typos and Latin are fine')
    expect(view.get('input').attributes('aria-describedby')).toBe(hint.attributes('id'))
    view.unmount()

    const plain = render()
    expect(plain.find('.hint').exists()).toBe(false)
    expect(plain.get('input').attributes('aria-describedby')).toBeUndefined()
    plain.unmount()
  })

  // A combobox gives the field its role and its keys (MOL-177, Р-1): they reach the input, while the
  // class stays on the field as a whole.
  it('hands its owner’s attributes and keys to the input, and its class to itself', async () => {
    const keys: string[] = []
    const view = render(
      { maxlength: 200, readonly: true },
      {
        attrs: {
          class: 'owner',
          role: 'combobox',
          'aria-expanded': 'true',
          'aria-activedescendant': 'option-1',
          onKeydown: (event: KeyboardEvent) => keys.push(event.key),
        },
      },
    )
    const input = view.get('input')
    expect(view.classes()).toContain('owner')
    expect(input.classes()).not.toContain('owner')
    expect(input.attributes('role')).toBe('combobox')
    expect(input.attributes('aria-expanded')).toBe('true')
    expect(input.attributes('aria-activedescendant')).toBe('option-1')
    expect(input.attributes('maxlength')).toBe('200')
    expect(input.attributes('readonly')).toBeDefined()
    expect(view.attributes('role')).toBeUndefined()
    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(keys).toEqual(['ArrowDown'])
    view.unmount()
  })

  describe('Esc in a sheet (adversarial А3)', () => {
    // Chromium clears a search field on Esc and the dialog never hears `cancel`: «Выбрать товар» lost
    // the receipt's words and stayed open. In a sheet Esc is «back» (MOL-80).
    function inSheet(open: boolean, attrs: Record<string, unknown> = {}) {
      const sheet = document.createElement('dialog')
      if (open) sheet.setAttribute('open', '')
      document.body.append(sheet)
      const heard: string[] = []
      sheet.addEventListener('cancel', () => heard.push('cancel'))
      const view = mount(SearchField, {
        props: { modelValue: 'ПАНИР ЛОРИ', label: 'Pick an item', clearable: true },
        attrs,
        attachTo: sheet,
        global: { plugins: [createAppI18n('en')] },
      })
      return { sheet, heard, view }
    }

    it('closes the sheet and keeps the text', async () => {
      const { sheet, heard, view } = inSheet(true)
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      view.get('input').element.dispatchEvent(event)
      await view.vm.$nextTick()
      expect(event.defaultPrevented).toBe(true)
      expect(heard).toEqual(['cancel'])
      expect(view.emitted('update:modelValue')).toBeUndefined()
      view.unmount()
      sheet.remove()
    })

    it('must not take Esc outside an open sheet — clearing is the platform’s way there', () => {
      const { sheet, heard, view } = inSheet(false)
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      view.get('input').element.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
      expect(heard).toEqual([])
      view.unmount()
      sheet.remove()
    })

    it('leaves an Esc its owner took — a combobox letting go of its row — and another key alone', () => {
      const { sheet, heard, view } = inSheet(true, {
        onKeydown: (event: KeyboardEvent) => {
          if (event.key === 'Escape') event.preventDefault()
        },
      })
      const input = view.get('input').element
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      )
      expect(heard).toEqual([])
      view.unmount()
      sheet.remove()
    })
  })

  it('takes the focus when its owner asks, and lets it go', () => {
    const view = render()
    const field = view.vm as unknown as { focus: () => void; blur: () => void }
    field.focus()
    expect(document.activeElement).toBe(view.get('input').element)
    field.blur()
    expect(document.activeElement).not.toBe(view.get('input').element)
    view.unmount()
  })
})
