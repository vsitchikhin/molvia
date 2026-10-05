/// <reference lib="dom" />
// DOM for the code inside page.evaluate, which runs in the browser.
import { expect, test } from '@playwright/test'
import { open } from './session'

/**
 * The kit's rows in a real engine (MOL-175): what a component test cannot see, since happy-dom
 * computes no style. Run in the phone's Chromium and in the iPhone's WebKit.
 */

// The focus of a chosen row stood on its ring — 2 px of the same colour on the same place — and the
// keyboard lost the row it stood on (adversarial А1, review Р2-1, WCAG 2.4.7). It stands inside the
// ring now, the fill between them, both on the row's rounded layer.
test('a chosen row shows the keyboard’s focus inside its ring, with the fill between', async ({
  page,
}) => {
  await open(page, '/_kit')
  const picker = page.getByRole('radiogroup', { name: 'Purchases account' })
  const chosen = picker.getByRole('radio', { checked: true })
  // A key first, so the engine takes the focus that follows for the keyboard's (WebKit tabs fields only).
  await page.keyboard.press('Tab')
  await chosen.focus()
  const look = await chosen.evaluate((row) => {
    const layer = getComputedStyle(row, '::before')
    const ring = /(-?[\d.]+)px inset|inset[^,]*?(-?[\d.]+)px\s*$/.exec(layer.boxShadow)
    return {
      visible: row.matches(':focus-visible'),
      own: getComputedStyle(row).outlineStyle,
      outline: layer.outlineStyle,
      offset: parseFloat(layer.outlineOffset),
      ring: parseFloat(ring?.[1] ?? ring?.[2] ?? 'NaN'),
    }
  })
  expect(look.visible).toBe(true)
  expect(look.own).toBe('none')
  expect(look.outline).toBe('solid')
  expect(look.ring).toBe(2)
  // The outline's outer edge lies `-offset` inside the layer; the ring takes the first 2 px of it.
  expect(-look.offset - look.ring).toBeGreaterThanOrEqual(2)
})

// Rounded itself, a chosen row bent the hairline the list card draws as its `border-top` (round 3,
// Р3-1; adversarial Б1): the row stays square, its fill and ring are a rounded layer.
test('a chosen row keeps the card’s hairline above it straight', async ({ page }) => {
  await open(page, '/_kit')
  const picker = page.getByRole('radiogroup', { name: 'Purchases account' })
  const second = picker.getByRole('radio').nth(1)
  await second.tap()
  await expect(second).toHaveAttribute('aria-checked', 'true')
  const edge = await second.evaluate((row) => {
    const style = getComputedStyle(row)
    return {
      hairline: style.borderTopWidth,
      left: style.borderTopLeftRadius,
      right: style.borderTopRightRadius,
      layer: getComputedStyle(row, '::before').borderTopLeftRadius,
    }
  })
  expect(edge).toMatchObject({ hairline: '1px', left: '0px', right: '0px' })
  expect(edge.layer).not.toBe('0px')
})

// The keyboard standing on the value already chosen: the row's own square fill stood out past the round
// ring at every corner (adversarial В1). The kit shows the two states apart, so the found row the
// keyboard stands on is made chosen here, by the class the row draws it with.
test('a chosen row the keyboard stands on takes its fill from its round layer alone', async ({
  page,
}) => {
  await open(page, '/_kit')
  const active = page.getByRole('listbox', { name: 'Found' }).getByRole('option').first()
  await expect(active).toHaveClass(/\bactive\b/)
  const fills = await active.evaluate(async (row) => {
    const read = () => getComputedStyle(row).backgroundColor
    const alone = read()
    row.classList.add('selected')
    await new Promise((done) => requestAnimationFrame(done))
    return { alone, chosen: read(), layer: getComputedStyle(row, '::before').backgroundColor }
  })
  expect(fills.alone).not.toBe('rgba(0, 0, 0, 0)')
  expect(fills.chosen).toBe('rgba(0, 0, 0, 0)')
  expect(fills.layer).toBe(fills.alone)
})

// One search field (MOL-177, Ф-12): a pill on the well's ground, the same height whatever stands at its
// end. The option the arrows stand on is filled at the weight of every row (К-4), and its meta is in
// the text's colour — muted stands under 4.5:1 on the tint (MOL-172).
test('the search field is one pill, and the active option keeps its weight and reads its meta in text', async ({
  page,
}) => {
  await open(page, '/_kit')
  const wells = await page.getByRole('searchbox').evaluateAll((inputs) =>
    inputs.map((input) => {
      const well = input.parentElement!
      return {
        height: well.getBoundingClientRect().height,
        radius: parseFloat(getComputedStyle(well).borderTopLeftRadius),
      }
    }),
  )
  expect(wells).toHaveLength(3)
  // A target of 44 inside an edge of 1 — 46, as every field of the kit (owner's choice on review Р1-3).
  for (const well of wells) {
    expect(well.height).toBe(46)
    expect(well.radius).toBeGreaterThanOrEqual(well.height / 2)
  }

  const active = page.getByRole('listbox', { name: 'Found' }).getByRole('option').first()
  await expect(active).toHaveAttribute('aria-selected', 'true')
  const look = await active.evaluate((row) => {
    const title = getComputedStyle(row.querySelector('.title')!)
    const meta = getComputedStyle(row.querySelector('.meta')!)
    return {
      tag: row.tagName,
      weight: title.fontWeight,
      title: title.color,
      meta: meta.color,
      fill: getComputedStyle(row).backgroundColor,
    }
  })
  expect(look.tag).toBe('LI')
  expect(look.weight).toBe('600')
  expect(look.meta).toBe(look.title)
  expect(look.fill).not.toBe('rgba(0, 0, 0, 0)')
})

// A chosen row with a meta stands on the same tint: its meta is in the text's colour too (MOL-177, the
// defect of MOL-175 — muted there is 3.83:1 in the dark).
test('a chosen row reads its meta in text on its tint', async ({ page }) => {
  await open(page, '/_kit')
  const chosen = page
    .getByRole('radiogroup', { name: 'Purchases account' })
    .getByRole('radio', { checked: true })
  const colours = await chosen.evaluate((row) => ({
    title: getComputedStyle(row.querySelector('.title')!).color,
    meta: getComputedStyle(row.querySelector('.meta')!).color,
  }))
  expect(colours.meta).toBe(colours.title)
})

// The end of a name tells items apart — the fat, the size (adversarial А1): an option of the list a field
// owns breaks its name onto lines rather than ending it in «…», at 390 and at 320.
for (const width of [390, 320])
  test(`at ${String(width)} an option of the search list shows its whole name`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 })
    await open(page, '/_kit')
    const titles = await page
      .getByRole('listbox', { name: 'Found' })
      .getByRole('option')
      .evaluateAll((rows) =>
        rows.map((row) => {
          const title = row.querySelector<HTMLElement>('.title')!
          const style = getComputedStyle(title)
          return {
            cut: title.scrollWidth > title.clientWidth,
            ellipsis: style.textOverflow === 'ellipsis' && style.whiteSpace === 'nowrap',
            lines: Math.round(title.getBoundingClientRect().height / parseFloat(style.lineHeight)),
          }
        }),
      )
    expect(titles).toHaveLength(2)
    for (const title of titles) expect(title).toMatchObject({ cut: false, ellipsis: false })
    // The long name of the kit takes more than a line at either width.
    expect(titles[1]?.lines).toBeGreaterThan(1)
  })

// One row of an operation (MOL-176, Ф-12): every row has its chevron, so the amounts end in one column
// — and the bars of its skeleton end there too, or the list would jump as the answer comes.
test('the amounts of operation rows stand in one column, where their skeleton’s stand', async ({
  page,
}) => {
  await open(page, '/_kit')
  const section = page.locator('section', {
    has: page.getByRole('heading', { name: 'Operation row' }),
  })
  await expect(section.locator('.amount').first()).toBeVisible()
  const edges = await section.evaluate((root) => {
    const right = (selector: string) =>
      [...root.querySelectorAll(selector)].map((one) => one.getBoundingClientRect().right)
    return { rows: right('.list-row .amount'), bars: right('.row .amount') }
  })
  expect(edges.rows.length).toBeGreaterThan(5)
  expect(edges.bars.length).toBe(3)
  for (const edge of [...edges.rows, ...edges.bars]) expect(edge).toBeCloseTo(edges.rows[0] ?? 0, 0)
})

// Е-11: a row cut its title, the day in its meta and the sum in it to «…». On the phone the title breaks
// onto lines and the meta, the amount and the line under it are whole; on a phone of 320 still no
// amount, line under it or tag is cut or stands over another. A long line under an amount — drams from a
// ruble card, a trip in two currencies — once took the whole row: the title 0 px wide, the chevron past
// the card, which cut it (adversarial А1, А2). The line wraps now and the words keep their part; every
// chevron, the one of a row with no tail too (review Р2-1), stands in one place inside the card.
for (const width of [390, 320])
  test(`at ${String(width)} nothing of an operation row is cut or overlaps — the title breaks instead`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 })
    await open(page, '/_kit')
    const section = page.locator('section', {
      has: page.getByRole('heading', { name: 'Operation row' }),
    })
    await expect(section.locator('.amount').first()).toBeVisible()
    const look = await section.evaluate((root) => {
      const cut = (one: Element) =>
        one.scrollWidth > one.clientWidth || one.scrollHeight > one.clientHeight + 1
      const rows = [...root.querySelectorAll('.list-row')]
      const over = rows.filter((row) => {
        const words = row.querySelector('.words')?.getBoundingClientRect()
        const tail = row.querySelector('.tail')?.getBoundingClientRect()
        const below = row.querySelector('.below > *')?.getBoundingClientRect()
        // Over it, not beside or above it: under the words the tail is on a line of its own.
        return Boolean(
          words &&
          tail &&
          below &&
          below.right > tail.left &&
          below.bottom > tail.top &&
          below.top < tail.bottom,
        )
      })
      const titles = rows.flatMap((row) => {
        const title = row.querySelector('.title')
        if (!title) return []
        const lines =
          title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight)
        return [{ cut: cut(title), lines }]
      })
      const card = root.querySelector('ul')?.getBoundingClientRect()
      const chevrons = rows.map(
        (row) => row.querySelector('.chevron')?.getBoundingClientRect().right ?? Number.NaN,
      )
      // A narrow row stands its tail under the words, on a line of its own (owner's choice on Б1, Б2).
      const under = rows.filter((row) => {
        const words = row.querySelector('.words')?.getBoundingClientRect()
        const tail = row.querySelector('.tail')?.getBoundingClientRect()
        return Boolean(words && tail && tail.top >= words.bottom - 1)
      }).length
      return {
        tails: root.querySelectorAll('.list-row .tail').length,
        under,
        narrowest: Math.min(
          ...rows.map((row) => row.querySelector('.words')?.getBoundingClientRect().width ?? 0),
        ),
        chevronsOut: chevrons.filter((one) => !(one <= (card?.right ?? 0))).length,
        chevronsApart: chevrons.filter((one) => Math.abs(one - (chevrons[0] ?? 0)) > 0.5).length,
        tailsCut: [
          ...root.querySelectorAll('.list-row .amount, .list-row .sub, .list-row .tag'),
        ].filter(cut).length,
        overlaps: over.length,
        metasCut: [...root.querySelectorAll('.list-row .meta')].filter(cut).length,
        titlesCut: titles.filter((one) => one.cut).length,
        longest: Math.max(...titles.map((one) => one.lines)),
        page: document.documentElement.scrollWidth,
      }
    })
    expect(look).toMatchObject({
      chevronsOut: 0,
      chevronsApart: 0,
      tailsCut: 0,
      overlaps: 0,
      titlesCut: 0,
      page: width,
    })
    // On 320 the card is under 22rem: every tail under its words, and the words the whole width. On 390
    // (a card of 358) the tails stand beside the words, at most 45 % of the row unless an amount needs more.
    expect(look.under).toBe(width === 320 ? look.tails : 0)
    expect(look.narrowest).toBeGreaterThanOrEqual(width === 320 ? 150 : 80)
    expect(look.longest).toBeGreaterThanOrEqual(2)
    // Two lines are the meta's on a phone of 390; on 320 the other half of an exchange may end in «…».
    if (width === 390) expect(look.metasCut).toBe(0)
  })

// The skeleton is the answer's shape (MOL-176, R-14): a row of bars as tall as a row of the answer, its
// amount where the answer's stands — beside the words on a wide card, under them on a narrow one. It kept
// the wide shape alone, and a day of twelve rows would have grown by 300 px as the answer came
// (adversarial round 3, В1).
for (const width of [390, 320])
  test(`at ${String(width)} a row of the skeleton is the shape of a row of the answer`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 })
    await open(page, '/_kit')
    const section = page.locator('section', {
      has: page.getByRole('heading', { name: 'Operation row' }),
    })
    // A title, a meta and an amount with no line under it — what a bar stands for.
    const answer = section.locator('.list-row', { hasText: '+₽99,615' })
    await expect(answer).toBeVisible()
    // The row's height, where its amount ends, and how far down the row its amount's middle stands.
    const measure = (row: Element) => {
      const amount = row.querySelector('.amount')
      if (!amount) throw new Error('no amount')
      const box = row.getBoundingClientRect()
      const sum = amount.getBoundingClientRect()
      return { height: box.height, right: sum.right, middle: (sum.top + sum.bottom) / 2 - box.top }
    }
    const real = await answer.evaluate(measure)
    const bars = await section.locator('.item .row').first().evaluate(measure)
    expect(bars.height).toBeCloseTo(real.height, 0)
    expect(bars.right).toBeCloseTo(real.right, 0)
    expect(Math.abs(bars.middle - real.middle)).toBeLessThan(1)
  })
