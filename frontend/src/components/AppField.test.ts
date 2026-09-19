import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { ERROR } from '@molvia/model'
import en from '@/i18n/en.json'
import { createAppI18n } from '@/i18n'
import AppField from '@/components/AppField.vue'

type Props = InstanceType<typeof AppField>['$props']

function render(props: Partial<Props> = {}, slots: Record<string, string> = {}) {
  return mount(AppField, {
    props: { modelValue: '', label: 'How much', ...props },
    slots,
    attachTo: document.body,
    global: { plugins: [createAppI18n('en')] },
  })
}

describe('AppField', () => {
  it('ties the label to the input', () => {
    const view = render()
    const input = view.get('input')
    expect(view.get('label').attributes('for')).toBe(input.attributes('id'))
    expect(view.get('label').text()).toBe('How much')
    view.unmount()
  })

  it('gives two fields on one screen two different ids', () => {
    const view = mount(
      defineComponent(() => () => [
        h(AppField, { modelValue: '', label: 'How much' }),
        h(AppField, { modelValue: '', label: 'Price' }),
      ]),
      { global: { plugins: [createAppI18n('en')] } },
    )
    const [first, second] = view.findAll('input').map((input) => input.attributes('id'))
    expect(first).toBeTruthy()
    expect(first).not.toBe(second)
  })

  // `type="number"` gives spinners, refuses the comma of a Russian keyboard and silently drops
  // what it cannot read.
  it('opens the decimal keyboard for money and quantities, never type=number', () => {
    const input = render({ kind: 'decimal' }).get('input')
    expect(input.attributes('type')).toBe('text')
    expect(input.attributes('inputmode')).toBe('decimal')
  })

  it('asks for no special keyboard for plain text', () => {
    const input = render().get('input')
    expect(input.attributes('type')).toBe('text')
    expect(input.attributes('inputmode')).toBeUndefined()
  })

  it('opens the system date picker for a date', () => {
    expect(render({ kind: 'date' }).get('input').attributes('type')).toBe('date')
  })

  it('writes a review in several lines', () => {
    const view = render({ kind: 'multiline' })
    expect(view.find('input').exists()).toBe(false)
    expect(view.get('textarea').attributes('id')).toBe(view.get('label').attributes('for'))
  })

  // The field reads nothing: the server decides what a number is.
  it('hands back the raw string, comma and all', async () => {
    const value = ref('')
    const view = mount(
      defineComponent(
        () => () =>
          h(AppField, {
            modelValue: value.value,
            label: 'How much',
            kind: 'decimal',
            'onUpdate:modelValue': (next: string) => (value.value = next),
          }),
      ),
      { global: { plugins: [createAppI18n('en')] } },
    )
    await view.get('input').setValue('1,128')
    expect(value.value).toBe('1,128')
  })

  it('shows the error from the registry and ties it to the input', () => {
    const view = render({ error: ERROR.INVALID_AMOUNT })
    const input = view.get('input')
    const error = view.get('.error')
    expect(error.text()).toBe(en.error.invalid_amount)
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(input.attributes('aria-describedby')).toBe(error.attributes('id'))
    expect(view.classes()).toContain('invalid')
  })

  it('shows words the screen gave when the registry has no code, over the code', () => {
    const view = render({ error: ERROR.INVALID_AMOUNT, errorText: 'Свои слова экрана' })
    const error = view.get('.error')
    expect(error.text()).toBe('Свои слова экрана')
    expect(view.get('input').attributes('aria-invalid')).toBe('true')
    expect(view.get('input').attributes('aria-describedby')).toBe(error.attributes('id'))
  })

  it('must not fire: no error — no aria-invalid and no empty message', () => {
    const view = render()
    const input = view.get('input')
    expect(input.attributes('aria-invalid')).toBeUndefined()
    expect(input.attributes('aria-describedby')).toBeUndefined()
    expect(view.find('.error').exists()).toBe(false)
  })

  it('reads the tail after the value without making it part of the value', () => {
    const view = render({ modelValue: '570', kind: 'decimal' }, { suffix: '֏' })
    const input = view.get('input')
    const suffix = view.get('.suffix')
    expect((input.element as HTMLInputElement).value).toBe('570')
    expect(suffix.text()).toBe('֏')
    expect(input.attributes('aria-describedby')).toBe(suffix.attributes('id'))
  })

  it('reads the tail and the error both', () => {
    const view = render({ error: ERROR.INVALID_AMOUNT }, { suffix: '֏' })
    const ids = view.get('input').attributes('aria-describedby')?.split(' ')
    expect(ids).toEqual([view.get('.suffix').attributes('id'), view.get('.error').attributes('id')])
  })

  it('passes readonly to the input', () => {
    const view = render({ readonly: true })
    expect(view.get('input').attributes('readonly')).toBeDefined()
    expect(view.classes()).toContain('readonly')
  })

  // A screen adds `autofocus` or `enterkeyhint` to the input it means, and lays the field out by
  // its class.
  it('puts extra attributes on the input and the class on the field', () => {
    const view = mount(AppField, {
      props: { modelValue: '', label: 'Price' },
      attrs: { class: 'price', enterkeyhint: 'done', maxlength: '12' },
      global: { plugins: [createAppI18n('en')] },
    })
    const input = view.get('input')
    expect(input.attributes('enterkeyhint')).toBe('done')
    expect(input.attributes('maxlength')).toBe('12')
    expect(input.classes()).not.toContain('price')
    expect(view.classes()).toContain('price')
  })
})
