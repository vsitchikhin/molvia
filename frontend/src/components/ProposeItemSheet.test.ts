import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ApiError } from '@molvia/client'
import type { CatalogueWrite } from '@molvia/client'
import { ERROR, ISSUE, ITEM_NAME_MAX, ITEM_NOTE_MAX } from '@molvia/model'
import type { BarcodeHint, CatalogueEntry, ProposedItem } from '@molvia/model'
import en from '@/i18n/en.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import ProposeItemSheet from '@/components/ProposeItemSheet.vue'

const proposeItem = vi.fn<(input: ProposedItem) => Promise<CatalogueWrite>>()
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

async function render(
  query = '  тан ',
  code: string | null = null,
  hint: BarcodeHint | null = null,
) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/trip/add')
  const wrapper = mount(ProposeItemSheet, {
    attachTo: document.body,
    props: { open: true, query, code, hint },
    global: { plugins: [router, createAppI18n('en')] },
  })
  mounted.push(wrapper)
  clock += 1000
  // Past the moment its status line waits before any words, too.
  await new Promise((resolve) => setTimeout(resolve, 120))
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

    expect(proposeItem).toHaveBeenCalledWith({
      kind: 'product',
      name: 'тан',
      defaultUnit: 'l',
      barcodes: [],
    })
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
      expect(sheet.emitted('proposed')).toEqual([[tan, true]])
    })
  })

  it('hands on the item already there the same way — «already there» is not an error', async () => {
    proposeItem.mockResolvedValue({ entry: tan, created: false })
    const sheet = await render()
    await chooseUnit(sheet, en.item.unit_l)

    await submitButton(sheet).trigger('click')

    await vi.waitFor(() => {
      expect(sheet.emitted('proposed')).toEqual([[tan, false]])
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

  describe('text pasted from elsewhere', () => {
    it('takes a row of a spreadsheet: the tab between cells becomes a space', async () => {
      proposeItem.mockResolvedValue({ entry: tan, created: true })
      const sheet = await render('')
      await chooseUnit(sheet, en.item.unit_l)

      await fields(sheet).name.setValue('Молоко\tАшхар')
      await fields(sheet).note.setValue('пастеризованное\t3,2%')

      expect(fields(sheet).name.element.value).toBe('Молоко Ашхар')
      expect(submitButton(sheet).attributes('disabled')).toBeUndefined()
      await submitButton(sheet).trigger('click')
      expect(proposeItem).toHaveBeenCalledWith({
        kind: 'product',
        name: 'Молоко Ашхар',
        defaultUnit: 'l',
        barcodes: [],
        note: 'пастеризованное 3,2%',
      })
    })

    it('starts from a query with a tab in it as one line', async () => {
      const sheet = await render('Молоко\tАшхар')
      expect(fields(sheet).name.element.value).toBe('Молоко Ашхар')
    })

    it('takes any break a paste brings — NEL, a line or paragraph separator — as a space', async () => {
      const sheet = await render('')
      await chooseUnit(sheet, en.item.unit_l)
      for (const code of [0x85, 0x2028, 0x2029]) {
        const brk = String.fromCodePoint(code)
        await fields(sheet).name.setValue('')
        await fields(sheet).note.setValue('')
        await fields(sheet).name.setValue(`Молоко${brk}Ашхар`)
        await fields(sheet).note.setValue(`Ашхар${brk}2%`)

        expect(fields(sheet).name.element.value, code.toString(16)).toBe('Молоко Ашхар')
        expect(fields(sheet).note.element.value, code.toString(16)).toBe('Ашхар 2%')
        expect(submitButton(sheet).attributes('disabled'), code.toString(16)).toBeUndefined()
      }
    })

    it('drops the direction marks and isolates a chat wraps a pasted name in — they draw nothing', async () => {
      const sheet = await render('')
      await chooseUnit(sheet, en.item.unit_l)
      const [open, close] = [String.fromCodePoint(0x2068), String.fromCodePoint(0x2069)]

      await fields(sheet).name.setValue(`${open}Молоко «Ашхар»${close}`)
      await fields(sheet).note.setValue(`${String.fromCodePoint(0x202b)}2%${close}`)

      expect(fields(sheet).name.element.value).toBe('Молоко «Ашхар»')
      expect(fields(sheet).note.element.value).toBe('2%')
      expect(submitButton(sheet).attributes('disabled')).toBeUndefined()
      expect(sheet.text()).not.toContain(en.item.propose.name_invalid)
      expect(sheet.text()).not.toContain(en.item.propose.note_invalid)
    })

    it('says which field holds what is left to refuse, and that it has to be typed again', async () => {
      const privateUse = String.fromCodePoint(0xe000)
      const sheet = await render('Молоко')
      await chooseUnit(sheet, en.item.unit_l)

      await fields(sheet).name.setValue(`Молоко${privateUse}`)
      expect(submitButton(sheet).attributes('disabled')).toBeDefined()
      expect(sheet.get('[role="status"]').text()).toBe(en.item.propose.name_invalid)

      await fields(sheet).name.setValue('Молоко')
      await fields(sheet).note.setValue(`2%${privateUse}`)
      expect(submitButton(sheet).attributes('disabled')).toBeDefined()
      expect(sheet.get('[role="status"]').text()).toBe(en.item.propose.note_invalid)
    })

    it('keeps its status line in place before there is anything to say — only the words change', async () => {
      const sheet = await render()
      const line = sheet.get('[role="status"]')
      expect(line.text()).toBe('')

      await fields(sheet).name.setValue(`тан${String.fromCodePoint(0xe000)}`)

      expect(sheet.get('[role="status"]').element).toBe(line.element)
      expect(line.text()).toBe(en.item.propose.name_invalid)
    })

    it('says its first words a moment after the sheet comes up, not in the same frame', async () => {
      online(false)
      const router = createRouter({ history: createMemoryHistory(), routes })
      await router.push('/trip/add')
      const sheet = mount(ProposeItemSheet, {
        attachTo: document.body,
        props: { open: true, query: 'тан' },
        global: { plugins: [router, createAppI18n('en')] },
      })
      mounted.push(sheet)

      expect(sheet.get('[role="status"]').text()).toBe('')
      await vi.waitFor(() => {
        expect(sheet.get('[role="status"]').text()).toBe(en.item.propose.offline)
      })
    })

    it('says nothing of the kind about a name not yet written', async () => {
      const sheet = await render('')
      expect(sheet.text()).not.toContain(en.item.propose.name_invalid)
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
      expect(proposeItem).toHaveBeenCalledWith({
        kind: 'product',
        name: 'тан',
        defaultUnit: 'l',
        barcodes: [],
      })
    })
  })

  describe('with a code read from the package (MOL-100)', () => {
    it('shows the code and sends it with the item', async () => {
      proposeItem.mockResolvedValue({ entry: tan, created: true })
      const sheet = await render('', '4850001234562')
      expect(sheet.text()).toContain(en.item.propose.code.replace('{code}', '4850001234562'))
      await fields(sheet).name.setValue('Тан')
      await chooseUnit(sheet, en.item.unit_l)

      await submitButton(sheet).trigger('click')

      expect(proposeItem).toHaveBeenCalledWith(
        expect.objectContaining({ barcodes: ['4850001234562'] }),
      )
      expect(sheet.emitted('proposed')).toEqual([[tan, true]])
    })

    it('names the item that holds the code and offers it instead of the button', async () => {
      const kefir = { ...tan, id: '1c7a3d5f-9e2b-4a4c-8d8f-6b3e2f1a4c5d', name: 'Кефир 1%' }
      proposeItem.mockResolvedValue({ taken: kefir })
      const sheet = await render('тан', '4850001234562')
      await chooseUnit(sheet, en.item.unit_l)

      await submitButton(sheet).trigger('click')
      await flushPromises()

      expect(sheet.text()).toContain(en.item.propose.taken.replace('{name}', 'Кефир 1%'))
      expect(sheet.emitted('proposed')).toBeUndefined()
      const take = sheet
        .findAll('button')
        .find((button) => button.text() === en.item.propose.take.replace('{name}', 'Кефир 1%'))
      await take?.trigger('click')
      expect(sheet.emitted('taken')).toEqual([[kefir]])
    })

    it('tells of a new item written with the code after the sheet was put away (Р6-Б)', async () => {
      let land!: (written: CatalogueWrite) => void
      proposeItem.mockReturnValue(new Promise((resolve) => (land = resolve)))
      const sheet = await render('Тан', '4850001234562')
      await chooseUnit(sheet, en.item.unit_l)
      await submitButton(sheet).trigger('click')

      await sheet.setProps({ open: false })
      land({ entry: tan, created: true })
      await flushPromises()

      expect(sheet.emitted('proposed')).toBeUndefined()
      expect(sheet.emitted('writtenLate')).toEqual([['4850001234562']])
    })

    it('must not tell of a late answer that wrote no code — a name already there (Р6-Б, control)', async () => {
      let land!: (written: CatalogueWrite) => void
      proposeItem.mockReturnValue(new Promise((resolve) => (land = resolve)))
      const sheet = await render('Тан', '4850001234562')
      await chooseUnit(sheet, en.item.unit_l)
      await submitButton(sheet).trigger('click')

      await sheet.setProps({ open: false })
      land({ entry: tan, created: false })
      await flushPromises()

      expect(sheet.emitted('writtenLate')).toBeUndefined()
    })

    it('must not show a code line when the item is proposed by its name', async () => {
      const sheet = await render()

      expect(sheet.text()).not.toContain(en.item.propose.code.split('{code}')[0] ?? '∅')
    })
  })

  describe('a hint of Open Food Facts (MOL-162)', () => {
    const CODE = '3017620422003'
    const nutella: BarcodeHint = {
      name: 'Nutella',
      quantity: { milli: 400n, unit: 'kg' },
      url: `https://world.openfoodfacts.org/product/${CODE}`,
    }
    const sizeLine = (sheet: VueWrapper) => sheet.find('.size')
    const source = (sheet: VueWrapper) => sheet.find('a.source')

    it('starts from the name, the unit and the size of the package, and links the base', async () => {
      const sheet = await render('', CODE, nutella)

      expect(fields(sheet).name.element.value).toBe('Nutella')
      expect(submitButton(sheet).attributes('disabled')).toBeUndefined()
      expect(sizeLine(sheet).text()).toContain('0.4 kg')
      expect(source(sheet).attributes()).toMatchObject({
        href: nutella.url,
        target: '_blank',
        rel: 'noopener noreferrer',
      })
    })

    it('sends the size of the package as how much is usually taken', async () => {
      proposeItem.mockResolvedValue({ entry: tan, created: true })
      const sheet = await render('', CODE, nutella)

      await submitButton(sheet).trigger('click')

      expect(proposeItem).toHaveBeenCalledWith({
        kind: 'product',
        name: 'Nutella',
        defaultUnit: 'kg',
        barcodes: [CODE],
        typicalQuantity: { milli: 400n, unit: 'kg' },
      })
    })

    it('lets the size go with ✕, and sends none then', async () => {
      proposeItem.mockResolvedValue({ entry: tan, created: true })
      const sheet = await render('', CODE, nutella)

      await sizeLine(sheet).find('button').trigger('click')
      await submitButton(sheet).trigger('click')

      expect(sizeLine(sheet).exists()).toBe(false)
      expect(proposeItem.mock.calls[0]?.[0]).not.toHaveProperty('typicalQuantity')
    })

    it('must not send a size in another unit: pieces chosen, the size is not shown or sent', async () => {
      proposeItem.mockResolvedValue({ entry: tan, created: true })
      const sheet = await render('', CODE, nutella)

      await chooseUnit(sheet, en.item.unit_piece)
      expect(sizeLine(sheet).exists()).toBe(false)
      await submitButton(sheet).trigger('click')

      expect(proposeItem.mock.calls[0]?.[0]).toMatchObject({ defaultUnit: 'piece' })
      expect(proposeItem.mock.calls[0]?.[0]).not.toHaveProperty('typicalQuantity')
    })

    it('must not take a hint that comes after the opening: the form stays as it opened (adversarial Д)', async () => {
      const sheet = await render('', CODE)
      await fields(sheet).name.setValue('Нут')
      await fields(sheet).name.setValue('')

      await sheet.setProps({ hint: nutella })

      expect(fields(sheet).name.element.value).toBe('')
      expect(sizeLine(sheet).exists()).toBe(false)
      expect(source(sheet).exists()).toBe(false)
      expect(submitButton(sheet).attributes('disabled')).toBeDefined()
    })

    it('puts the attribution last, under the code, as a target a thumb can take (review 2)', async () => {
      const sheet = await render('', CODE, nutella)
      const order = sheet.findAll('.code, a.source').map((node) => node.classes()[0])
      expect(order).toEqual(['code', 'source'])
    })

    it('must not take a hint over a name typed into the search', async () => {
      const sheet = await render('тан', CODE, nutella)

      expect(fields(sheet).name.element.value).toBe('тан')
      expect(sizeLine(sheet).exists()).toBe(false)
      expect(source(sheet).exists()).toBe(false)
    })

    it('a hint with no size gives the name only; the unit still waits', async () => {
      const sheet = await render('', CODE, { ...nutella, quantity: null })

      expect(fields(sheet).name.element.value).toBe('Nutella')
      expect(sizeLine(sheet).exists()).toBe(false)
      expect(submitButton(sheet).attributes('disabled')).toBeDefined()
      expect(source(sheet).exists()).toBe(true)
    })

    it('opens fresh: no size and no link of the opening before', async () => {
      const sheet = await render('', CODE, nutella)
      await sheet.setProps({ open: false })
      await sheet.setProps({ hint: null, query: 'тан' })
      await sheet.setProps({ open: true })

      expect(fields(sheet).name.element.value).toBe('тан')
      expect(sizeLine(sheet).exists()).toBe(false)
      expect(source(sheet).exists()).toBe(false)
    })
  })
})
