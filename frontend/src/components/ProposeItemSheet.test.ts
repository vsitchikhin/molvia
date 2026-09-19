import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ApiError } from '@molvia/client'
import { ERROR, ISSUE, ITEM_NAME_MAX, ITEM_NOTE_MAX } from '@molvia/model'
import type { CatalogueEntry, ProposedItem } from '@molvia/model'
import en from '@/i18n/en.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import ProposeItemSheet from '@/components/ProposeItemSheet.vue'

const proposeItem =
  vi.fn<(input: ProposedItem) => Promise<{ entry: CatalogueEntry; created: boolean }>>()
vi.mock('@/api', () => ({
  api: { proposeItem: (input: ProposedItem) => proposeItem(input) },
}))

const tan: CatalogueEntry = {
  id: '0b6f2c4e-8d1a-4f3b-9c7e-5a2d1e0f3b4c',
  kind: 'product',
  name: 'Тан',
  note: null,
  defaultUnit: 'l',
  typicalQuantity: null,
}

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

const mounted: VueWrapper[] = []

/**
 * The sheet takes no tap while it is still coming up (MOL-18); the clock is the test's, and a
 * rendered sheet is given the time to rise. A few real milliseconds too: Vue drops an event that
 * reaches a handler created in the same millisecond.
 */
let clock = 0

async function render(query = '  тан ') {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/trip/add')
  const wrapper = mount(ProposeItemSheet, {
    attachTo: document.body,
    props: { open: true, query },
    global: { plugins: [router, createAppI18n('en')] },
  })
  mounted.push(wrapper)
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 5))
  return wrapper
}

function fields(sheet: VueWrapper) {
  const inputs = sheet.findAll<HTMLInputElement>('input[type="text"]')
  const name = inputs[0]
  const note = inputs[1]
  if (!name || !note) throw new Error('the form has lost a field')
  return { name, note }
}

async function chooseUnit(sheet: VueWrapper, label: string): Promise<void> {
  const radio = sheet
    .findAll('label')
    .find((candidate) => candidate.text() === label)
    ?.find('input')
  if (!radio?.exists()) throw new Error(`no unit «${label}»`)
  await radio.setValue(true)
}

function submitButton(sheet: VueWrapper) {
  const button = sheet
    .findAll('button')
    .find((candidate) => candidate.text() === en.item.propose.submit)
  if (!button) throw new Error('no submit')
  return button
}

beforeEach(() => {
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  proposeItem.mockReset()
  online(true)
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('«Suggest an item»', () => {
  it('starts from what was typed into the search, trimmed', async () => {
    const sheet = await render()

    expect(fields(sheet).name.element.value).toBe('тан')
    expect(fields(sheet).note.element.value).toBe('')
  })

  it('waits for a unit: guessed wrong, it would be the unit of every later purchase', async () => {
    const sheet = await render()
    expect(submitButton(sheet).attributes('disabled')).toBeDefined()

    await chooseUnit(sheet, en.item.unit_l)

    expect(submitButton(sheet).attributes('disabled')).toBeUndefined()
  })

  it('waits for a name that draws something', async () => {
    const sheet = await render('')
    await chooseUnit(sheet, en.item.unit_kg)

    for (const blank of ['', '   ', String.fromCodePoint(0x200b)]) {
      await fields(sheet).name.setValue(blank)
      expect(submitButton(sheet).attributes('disabled'), JSON.stringify(blank)).toBeDefined()
    }
  })

  it('sends a product with its name and unit, and no note when none was written', async () => {
    proposeItem.mockResolvedValue({ entry: tan, created: true })
    const sheet = await render()
    await chooseUnit(sheet, en.item.unit_l)

    await submitButton(sheet).trigger('click')

    expect(proposeItem).toHaveBeenCalledWith({ kind: 'product', name: 'тан', defaultUnit: 'l' })
  })

  it('sends the note when there is one', async () => {
    proposeItem.mockResolvedValue({ entry: tan, created: true })
    const sheet = await render()
    await chooseUnit(sheet, en.item.unit_l)
    await fields(sheet).note.setValue('Ашхар, 2%')

    await submitButton(sheet).trigger('click')

    expect(proposeItem).toHaveBeenCalledWith(expect.objectContaining({ note: 'Ашхар, 2%' }))
  })

  it('hands the new item on', async () => {
    proposeItem.mockResolvedValue({ entry: tan, created: true })
    const sheet = await render()
    await chooseUnit(sheet, en.item.unit_l)

    await submitButton(sheet).trigger('click')

    await vi.waitFor(() => {
      expect(sheet.emitted('proposed')).toEqual([[tan]])
    })
  })

  it('hands on the item already there the same way — «already there» is not an error', async () => {
    proposeItem.mockResolvedValue({ entry: tan, created: false })
    const sheet = await render()
    await chooseUnit(sheet, en.item.unit_l)

    await submitButton(sheet).trigger('click')

    await vi.waitFor(() => {
      expect(sheet.emitted('proposed')).toEqual([[tan]])
    })
    expect(sheet.find('[role="alert"]').exists()).toBe(false)
  })

  it('sends once for a double tap', async () => {
    let answer!: (value: { entry: CatalogueEntry; created: boolean }) => void
    proposeItem.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const sheet = await render()
    await chooseUnit(sheet, en.item.unit_l)

    await submitButton(sheet).trigger('click')
    await submitButton(sheet).trigger('click')
    answer({ entry: tan, created: true })

    await vi.waitFor(() => {
      expect(sheet.emitted('proposed')).toHaveLength(1)
    })
    expect(proposeItem).toHaveBeenCalledTimes(1)
  })

  it('says it did not work when the server refuses, and lets the person try again', async () => {
    proposeItem.mockRejectedValueOnce(new ApiError(ISSUE.TEXT_NOT_VISIBLE, 'name'))
    const sheet = await render()
    await chooseUnit(sheet, en.item.unit_l)

    await submitButton(sheet).trigger('click')

    await vi.waitFor(() => {
      expect(sheet.get('[role="alert"]').text()).toBe(en.item.propose.failed)
    })
    expect(sheet.emitted('proposed')).toBeUndefined()
    expect(submitButton(sheet).attributes('disabled')).toBeUndefined()
  })

  it('waits for the connection offline rather than failing', async () => {
    online(false)
    const sheet = await render()
    await chooseUnit(sheet, en.item.unit_l)

    expect(sheet.text()).toContain(en.item.propose.offline)
    expect(submitButton(sheet).attributes('disabled')).toBeDefined()
    expect(proposeItem).not.toHaveBeenCalled()
  })

  it('says offline, not «did not work», when the connection went while sending', async () => {
    proposeItem.mockImplementation(() => {
      online(false)
      return Promise.reject(new ApiError(ERROR.INTERNAL, 'transport'))
    })
    const sheet = await render()
    await chooseUnit(sheet, en.item.unit_l)

    await submitButton(sheet).trigger('click')

    await vi.waitFor(() => {
      expect(sheet.text()).toContain(en.item.propose.offline)
    })
    expect(sheet.find('[role="alert"]').exists()).toBe(false)
  })

  it('comes back when the connection does', async () => {
    online(false)
    const sheet = await render()
    await chooseUnit(sheet, en.item.unit_l)

    online(true)
    window.dispatchEvent(new Event('online'))
    await sheet.vm.$nextTick()

    expect(submitButton(sheet).attributes('disabled')).toBeUndefined()
  })

  it('opens fresh each time, from the query of that moment', async () => {
    const sheet = await render()
    await chooseUnit(sheet, en.item.unit_l)
    await fields(sheet).note.setValue('старое')

    await sheet.setProps({ open: false })
    await sheet.setProps({ query: 'мацун', open: true })

    expect(fields(sheet).name.element.value).toBe('мацун')
    expect(fields(sheet).note.element.value).toBe('')
    expect(submitButton(sheet).attributes('disabled')).toBeDefined()
  })

  describe('closed while the suggestion is on its way', () => {
    function deferred() {
      let resolve!: (value: { entry: CatalogueEntry; created: boolean }) => void
      const promise = new Promise<{ entry: CatalogueEntry; created: boolean }>(
        (done) => (resolve = done),
      )
      return { promise, resolve }
    }

    it('picks nothing: × said no, whatever the server answers after it', async () => {
      const answer = deferred()
      proposeItem.mockReturnValue(answer.promise)
      const sheet = await render()
      await chooseUnit(sheet, en.item.unit_l)
      await submitButton(sheet).trigger('click')

      await sheet.setProps({ open: false })
      answer.resolve({ entry: tan, created: true })
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(sheet.emitted('proposed')).toBeUndefined()
    })

    it('opens afresh with a live button, and the old answer does not fill the new form', async () => {
      const answer = deferred()
      proposeItem.mockReturnValueOnce(answer.promise)
      const sheet = await render('тан')
      await chooseUnit(sheet, en.item.unit_l)
      await submitButton(sheet).trigger('click')

      await sheet.setProps({ open: false })
      await sheet.setProps({ query: 'мацун', open: true })
      clock += 1000
      await chooseUnit(sheet, en.item.unit_kg)
      expect(submitButton(sheet).attributes('disabled')).toBeUndefined()

      answer.resolve({ entry: tan, created: true })
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(sheet.emitted('proposed')).toBeUndefined()
      expect(submitButton(sheet).attributes('disabled')).toBeUndefined()
    })
  })

  describe('lengths and blanks', () => {
    it('stops the name and the note where the catalogue does, instead of going grey past it', async () => {
      const sheet = await render()

      expect(fields(sheet).name.attributes('maxlength')).toBe(String(ITEM_NAME_MAX))
      expect(fields(sheet).note.attributes('maxlength')).toBe(String(ITEM_NOTE_MAX))
    })

    it('leaves out a note that draws nothing, the way it leaves out spaces', async () => {
      proposeItem.mockResolvedValue({ entry: tan, created: true })
      const sheet = await render()
      await chooseUnit(sheet, en.item.unit_l)
      await fields(sheet).note.setValue(String.fromCodePoint(0x200b))

      expect(submitButton(sheet).attributes('disabled')).toBeUndefined()
      await submitButton(sheet).trigger('click')
      expect(proposeItem).toHaveBeenCalledWith({ kind: 'product', name: 'тан', defaultUnit: 'l' })
    })
  })
})
