import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { currencySchema, currencySign } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import CurrencySelect from '@/components/CurrencySelect.vue'

function render(modelValue: 'AMD' | 'RUB' | 'USD' | 'EUR' = 'AMD') {
  return mount(CurrencySelect, {
    props: { modelValue, label: 'Price currency' },
    global: { plugins: [createAppI18n('en')] },
  })
}

describe('CurrencySelect (MOL-235)', () => {
  it('offers every currency by its sign, the one given chosen, named aloud', () => {
    const view = render('USD')
    const select = view.get('select')
    expect(view.findAll('option').map((option) => option.attributes('value'))).toEqual(
      currencySchema.options,
    )
    expect(view.findAll('option').map((option) => option.text())).toEqual(
      currencySchema.options.map((currency) => currencySign(currency, 'en')),
    )
    expect(view.findAll('option').map((option) => option.text())).toContain('֏')
    expect((select.element as HTMLSelectElement).value).toBe('USD')
    expect(select.attributes('aria-label')).toBe('Price currency')
  })

  it('hands back the currency chosen', async () => {
    const view = render()
    await view.get('select').setValue('EUR')
    expect(view.emitted('update:modelValue')).toEqual([['EUR']])
  })

  it('must not fire: a value that is no currency is not handed back', async () => {
    const view = render()
    const select = view.get('select').element as HTMLSelectElement
    const stranger = document.createElement('option')
    stranger.value = 'XXX'
    select.add(stranger)
    select.value = 'XXX'
    await view.get('select').trigger('change')
    expect(view.emitted('update:modelValue')).toBeUndefined()
  })

  it('draws its arrow unheard', () => {
    expect(render().get('svg').attributes('aria-hidden')).toBe('true')
  })
})
