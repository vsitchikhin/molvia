import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { ERROR } from '@molvia/model'
import en from '@/i18n/en.json'
import { createAppI18n } from '@/i18n'
import AppField from '@/components/AppField.vue'
import { LINGER_MS } from '@/composables/useAnnouncer'

type Props = InstanceType<typeof AppField>['$props']

function render(
  props: Partial<Props> = {},
  slots: Record<string, string> = {},
  attrs: Record<string, string> = {},
) {
  return mount(AppField, {
    props: { modelValue: '', label: 'How much', ...props },
    slots,
    attrs,
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

  it('draws a date in words over the native field, which stays the one read aloud (MOL-82)', () => {
    const field = render({ kind: 'date', display: 'Сегодня, 27 сентября' })
    expect(field.get('.shown').text()).toBe('Сегодня, 27 сентября')
    expect(field.get('.shown').attributes('aria-hidden')).toBe('true')
    expect(field.get('input').classes()).toContain('veiled')
    expect(render({ kind: 'date', display: '' }).find('.shown').exists()).toBe(false)
    expect(render({ kind: 'text', display: 'x' }).find('.shown').exists()).toBe(false)
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

it('opens native select, preserves its label and all descriptions, and emits the selection', async () => {
  const view = render(
    {
      kind: 'select',
      placeholder: 'Choose',
      options: [{ value: 'AMD', label: 'Dram' }],
      error: ERROR.INVALID_AMOUNT,
    },
    {},
    { 'aria-describedby': 'city-hint' },
  )
  const select = view.get('select')
  expect(view.get('label').attributes('for')).toBe(select.attributes('id'))
  expect(view.get('option[value=""]').attributes('disabled')).toBeDefined()
  expect(select.attributes('aria-describedby')).toBe(
    `city-hint ${view.get('.error').attributes('id') ?? ''}`,
  )
  await select.setValue('AMD')
  expect(view.emitted('update:modelValue')).toEqual([['AMD']])
  view.unmount()
})

describe('the count of what is left (MOL-147)', () => {
  const counted = (value: string, counterFrom: number | null = 200) =>
    render({ modelValue: value, kind: 'multiline', counterFrom }, {}, { maxlength: '2000' })

  it('is silent while more than its share is left — 1799 characters say nothing', () => {
    const view = counted('a'.repeat(1799))
    expect(view.get('.counter').text()).toBe('')
    view.unmount()
  })

  it('counts from exactly its share: 1800 typed, 200 left', () => {
    const view = counted('a'.repeat(1800))
    expect(view.get('.counter').text()).toBe('200 characters left')
    view.unmount()
  })

  it('counts down as it is typed, in the plural of the language', () => {
    const view = counted('a'.repeat(1866))
    expect(view.get('.counter').text()).toBe('134 characters left')
    view.unmount()
    const one = counted('a'.repeat(1999))
    expect(one.get('.counter').text()).toBe('1 character left')
    one.unmount()
  })

  it('says the bound once nothing more fits', () => {
    const view = counted('a'.repeat(2000))
    expect(view.get('.counter').text()).toBe("That's the limit: 2000 characters")
    view.unmount()
  })

  it('is read with the field, not announced at every letter (review №4)', () => {
    const view = counted('a'.repeat(1866))
    const counter = view.get('.counter')
    expect(counter.attributes('aria-live')).toBeUndefined()
    expect(view.get('textarea').attributes('aria-describedby')).toContain(counter.attributes('id'))
    view.unmount()
  })

  it('says what is left as a mark is passed on the way down — the count coming, 100, 20, the end', async () => {
    const view = counted('')
    const region = view.get('.counter-spoken')
    expect(region.attributes('aria-live')).toBe('polite')
    expect(region.text()).toBe('')

    const said: string[] = []
    for (const length of [1799, 1800, 1801, 1899, 1900, 1950, 1979, 1980, 1999, 2000]) {
      await view.setProps({ modelValue: 'a'.repeat(length) })
      said.push(region.text())
    }

    expect(said).toEqual([
      '',
      '200 characters left',
      '200 characters left',
      '200 characters left',
      '100 characters left',
      '100 characters left',
      '100 characters left',
      '20 characters left',
      '20 characters left',
      "That's the limit: 2000 characters",
    ])
    view.unmount()
  })

  it('says what is truly left after a paste past two marks, not the mark (adversarial Н3)', async () => {
    const view = counted('a'.repeat(1700))
    await view.setProps({ modelValue: 'a'.repeat(1950) })
    expect(view.get('.counter-spoken').text()).toBe('50 characters left')
    view.unmount()
  })

  it('must not speak when the text gets shorter: erasing is heard by the field itself', async () => {
    const view = counted('a'.repeat(1979))
    await view.setProps({ modelValue: 'a'.repeat(1985) })
    expect(view.get('.counter-spoken').text()).toBe('15 characters left')

    await view.setProps({ modelValue: 'a'.repeat(1979) })

    expect(view.get('.counter-spoken').text()).toBe('15 characters left')
    expect(view.get('.counter').text()).toBe('21 characters left')
    view.unmount()
  })

  it('lets its words go after a while, or browse mode would read them as still true', async () => {
    vi.useFakeTimers()
    const view = counted('a'.repeat(1799))
    await view.setProps({ modelValue: 'a'.repeat(1800) })
    expect(view.get('.counter-spoken').text()).toBe('200 characters left')

    vi.advanceTimersByTime(LINGER_MS)
    await nextTick()

    expect(view.get('.counter-spoken').text()).toBe('')
    view.unmount()
    vi.useRealTimers()
  })

  it('takes its marks in order, whatever share is counted', async () => {
    const view = render(
      { modelValue: 'a'.repeat(1955), kind: 'multiline', counterFrom: 50 },
      {},
      { maxlength: '2000' },
    )
    await view.setProps({ modelValue: 'a'.repeat(1960) })
    expect(view.get('.counter-spoken').text()).toBe('')
    await view.setProps({ modelValue: 'a'.repeat(1981) })
    expect(view.get('.counter-spoken').text()).toBe('19 characters left')
    view.unmount()
  })

  it('must not tie a silent count to the field', () => {
    const view = counted('a'.repeat(10))
    expect(view.get('textarea').attributes('aria-describedby')).toBeUndefined()
    view.unmount()
  })

  it('must not be drawn unless asked for: every other field stays as it was', () => {
    const view = counted('a'.repeat(2000), null)
    expect(view.find('.counter').exists()).toBe(false)
    view.unmount()
  })
})
