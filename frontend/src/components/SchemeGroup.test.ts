import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import SchemeGroup from '@/components/SchemeGroup.vue'
import { SCHEME_KEY, installColorScheme, useColorScheme } from '@/composables/useColorScheme'
import { createAppI18n } from '@/i18n'
import ru from '@/i18n/ru.json'

const views: VueWrapper[] = []
function render(): VueWrapper {
  const view = mount(SchemeGroup, { global: { plugins: [createAppI18n('ru')] } })
  views.push(view)
  return view
}

function checked(view: VueWrapper): string[] {
  return view
    .findAll('input')
    .filter((input) => (input.element as HTMLInputElement).checked)
    .map((input) => input.attributes('value') ?? '')
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  useColorScheme().choose('system')
  delete document.documentElement.dataset.scheme
})

afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
})

describe('SchemeGroup', () => {
  it('offers the three, in the owner’s words, and says the choice is this device’s', () => {
    const view = render()
    expect(view.get('h2').text()).toBe(ru.settings.group_scheme)
    expect(view.findAll('.segment').map((segment) => segment.text())).toEqual([
      ru.settings.scheme.system,
      ru.settings.scheme.light,
      ru.settings.scheme.dark,
    ])
    const hint = view.get('.hint')
    expect(hint.text()).toBe(ru.settings.scheme.hint)
    expect(view.get('fieldset').attributes('aria-describedby')).toBe(hint.attributes('id'))
    expect(view.get('fieldset').classes()).toContain('fit')
  })

  it('shows what this device keeps', () => {
    localStorage.setItem(SCHEME_KEY, 'dark')
    installColorScheme()
    expect(checked(render())).toEqual(['dark'])
  })

  it('shows «Системная» with nothing kept', () => {
    expect(checked(render())).toEqual(['system'])
  })

  it('a tap draws the scheme and keeps it, with nothing to save', async () => {
    const view = render()
    await view.get('input[value="light"]').setValue(true)
    expect(document.documentElement.dataset.scheme).toBe('light')
    expect(localStorage.getItem(SCHEME_KEY)).toBe('light')
    expect(checked(view)).toEqual(['light'])
    expect(view.find('button').exists()).toBe(false)
  })

  it('«Системная» takes the key away and gives the screen back to the system', async () => {
    const view = render()
    await view.get('input[value="dark"]').setValue(true)
    await view.get('input[value="system"]').setValue(true)
    expect(localStorage.getItem(SCHEME_KEY)).toBeNull()
    expect(document.documentElement.dataset.scheme).toBeUndefined()
  })

  it('moves with a choice made in another window', async () => {
    installColorScheme()
    const view = render()
    localStorage.setItem(SCHEME_KEY, 'dark')
    window.dispatchEvent(new StorageEvent('storage', { key: SCHEME_KEY, newValue: 'dark' }))
    await view.vm.$nextTick()
    expect(checked(view)).toEqual(['dark'])
  })
})
