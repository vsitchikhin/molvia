import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Component } from 'vue'
import LocaleGroup from '@/components/LocaleGroup.vue'
import { LOCALE_KEY, installLocale, useLocale } from '@/composables/useLocale'
import { i18n } from '@/i18n'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'

// The app's own i18n, not a test's: a choice moves the one the app speaks, and the group is drawn by it.
const views: VueWrapper[] = []
function render(component: Component): VueWrapper {
  const view = mount(component, { global: { plugins: [i18n] } })
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
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ru-RU'])
  useLocale().choose('device')
  useLocale().chooseStyle('gb')
  localStorage.clear()
  sessionStorage.clear()
  // Spoken as the app starts: the device's language, which the module took before the phone was set.
  installLocale()
})

afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  vi.restoreAllMocks()
})

describe('LocaleGroup', () => {
  it('offers the device’s and the two languages, each named in itself, and says whose the choice is', () => {
    const view = render(LocaleGroup)
    expect(view.get('h2').text()).toBe(ru.settings.group_locale)
    const segments = view.findAll('.segment')
    expect(segments.map((segment) => segment.text())).toEqual([
      ru.settings.locale.device,
      'Русский',
      'English',
    ])
    expect(segments.map((segment) => segment.attributes('lang'))).toEqual([undefined, 'ru', 'en'])
    const hint = view.get('.hint')
    expect(hint.text()).toBe(ru.settings.locale.hint)
    expect(view.get('fieldset').attributes('aria-describedby')).toBe(hint.attributes('id'))
  })

  it('shows what this device keeps', () => {
    localStorage.setItem(LOCALE_KEY, 'en')
    installLocale()
    expect(checked(render(LocaleGroup))).toEqual(['en'])
  })

  it('a tap speaks the language at once, with nothing to save, and «как на устройстве» gives it back', async () => {
    const view = render(LocaleGroup)
    await view.get('input[value="en"]').setValue(true)
    expect(view.get('h2').text()).toBe(en.settings.group_locale)
    expect(document.documentElement.lang).toBe('en-GB')
    expect(localStorage.getItem(LOCALE_KEY)).toBe('en')
    expect(view.find('button').exists()).toBe(false)

    await view.get('input[value="device"]').setValue(true)
    expect(view.get('h2').text()).toBe(ru.settings.group_locale)
    expect(localStorage.getItem(LOCALE_KEY)).toBe('device')
  })
})
