/// <reference lib="dom" />
// DOM for the code inside page.evaluate, which runs in the browser.
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
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

// The list card clips its rows to its radius, and the square ring of a row at its edge was cut at the
// card's corners — «Add by hand», the one row of its card, lost all four (MOL-203, adversarial А1). A row
// in focus is rounded at the card's own edges and the ring follows; between rows it stays square, so the
// hairline above a row stays straight.
test('a row in focus at the card’s edge is rounded as the card there, and square between rows', async ({
  page,
}) => {
  await open(page, '/_kit')
  const card = page
    .getByRole('heading', { name: 'Goes on' })
    .locator('xpath=following-sibling::ul[1]')
  const corners = async (row: Locator) => {
    // A key first, so the engine takes the focus that follows for the keyboard's.
    await page.keyboard.press('Tab')
    await row.focus()
    return row.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        visible: element.matches(':focus-visible'),
        top: [style.borderTopLeftRadius, style.borderTopRightRadius],
        bottom: [style.borderBottomLeftRadius, style.borderBottomRightRadius],
      }
    })
  }
  const round = ['20px', '20px']
  const square = ['0px', '0px']
  expect(await corners(card.getByRole('button', { name: /^Cash, drams/ }))).toEqual({
    visible: true,
    top: round,
    bottom: square,
  })
  expect(await corners(card.getByRole('button', { name: /^An explanation/ }))).toEqual({
    visible: true,
    top: square,
    bottom: square,
  })
  expect(await corners(card.getByRole('link', { name: /^A link while offline/ }))).toEqual({
    visible: true,
    top: square,
    bottom: round,
  })
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
  // Three of the search section and the one the skeleton's field stands under (MOL-178).
  expect(wells).toHaveLength(4)
  // A target of 44 inside an edge of 1 — 46, as every field of the kit (owner's choice on review Р1-3).
  // To a hundredth: a box at a fractional offset measures 45.9998 (MOL-225 put a section above it).
  for (const well of wells) {
    expect(well.height).toBeCloseTo(46, 2)
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
    const widths = [...root.querySelectorAll('.row .amount')].map(
      (one) => one.getBoundingClientRect().width,
    )
    return { rows: right('.list-row .amount'), bars: right('.row .amount'), widths }
  })
  expect(edges.rows.length).toBeGreaterThan(5)
  expect(edges.bars.length).toBe(3)
  // A bar of no width ends there too (MOL-178): the bars must be seen.
  for (const width of edges.widths) expect(width).toBeGreaterThan(20)
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

// The skeleton is the answer's shape (MOL-178, Ф-13): each part of the kit as tall as the answer it stands
// for — the well of a search, a caption, a row of `ListRow` with its amount, a row of `OperationRow` with a
// line under its amount (owner's В-3 «б») — and each amount where the answer's ends, at both widths: on a
// card narrower than 22rem an operation's amount and the line under it stand under the words, in the bars
// too (`narrow`), and a `ListRow`'s stays beside them, in the bars too (adversarial А1).
for (const width of [390, 320])
  test(`at ${String(width)} each part of the skeleton is as tall as the answer it stands for`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 })
    await open(page, '/_kit')
    const section = page.locator('section', {
      has: page.getByRole('heading', { name: 'Skeleton' }),
    })
    await expect(section.locator('[data-part="under"]')).toBeVisible()
    const parts = await section.evaluate((root) => {
      const box = (selector: string) => {
        const one = root.querySelector(selector)
        if (!one) throw new Error(`no ${selector}`)
        return one.getBoundingClientRect()
      }
      const pair = (part: string, answer: string, bars: string) => ({
        answer: box(`[data-part="${part}"] ${answer}`).height,
        bars: box(`[data-part="${part}"] ${bars}`).height,
      })
      return {
        field: pair('field', '.well', '.skeleton-field'),
        caption: pair('caption', '.section-caption', '.skeleton-caption'),
        rows: pair('rows', '.list-row', '.row'),
        under: pair('under', '.list-row', '.row'),
        amount: {
          answer: box('[data-part="under"] .list-row .amount').right,
          bars: box('[data-part="under"] .row .amount').right,
        },
        // A `ListRow` in a plain `li` keeps its amount beside the words at any width, and so do its
        // bars (adversarial А1): where the answer's tail ends, theirs ends.
        tail: {
          answer: box('[data-part="rows"] .list-row .tail').right,
          bars: box('[data-part="rows"] .row .amount').right,
        },
        // Seen at all: a bar of no width stands at the right edge too, and passed the line above.
        widths: [...root.querySelectorAll('[data-part="under"] .row .tail .bar')].map(
          (bar) => bar.getBoundingClientRect().width,
        ),
      }
    })
    const { widths, ...pairs } = parts
    for (const { answer, bars } of Object.values(pairs)) expect(bars).toBeCloseTo(answer, 0)
    expect(widths).toHaveLength(2)
    for (const one of widths) expect(one).toBeGreaterThan(20)
  })

// The card of the month on «Деньги» and the `figure` part (MOL-183, the tail of MOL-178): the sum stood
// at the body's leading and «≈» at 17 under it, and the answer came some 8 px taller than its bars. The
// caption's line, the figure at `--leading-tight` and «≈» at the same: the tiles come in exactly where
// the plate stood, at both widths.
for (const width of [390, 320])
  test(`at ${String(width)} the month's tiles come in where the skeleton's plate stood`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 })
    await open(page, '/_kit')
    const pair = page.locator('[data-part="figure"]')
    await expect(pair.locator('.tiles')).toBeVisible()
    const tops = await pair.evaluate((root) => {
      const below = (inner: string, outer: string) => {
        const one = root.querySelector(inner)
        const card = root.querySelector(outer)
        if (!one || !card) throw new Error(`no ${inner} in ${outer}`)
        return one.getBoundingClientRect().top - card.getBoundingClientRect().top
      }
      return {
        answer: below('.spent .tiles', '.spent'),
        bars: below('.sum-card .plate', '.sum-card'),
      }
    })
    expect(tops.bars).toBeCloseTo(tops.answer, 0)
  })

// The total of the record typed by hand and the `figure` part (MOL-206, the debt of MOL-178): while the
// total was a strip nothing held its height. A card now, the caption's line, the figure at
// `--leading-tight` and the line of its parts stand where the part's bars stand, and the card is as tall
// as the part, at both widths — a line wrapped at 320 is the answer's own price, not the kit's.
for (const width of [390, 320])
  test(`at ${String(width)} the record's total is as tall as its skeleton`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 })
    await open(page, '/_kit')
    const pair = page.locator('[data-part="trip-total"]')
    await expect(pair.locator('.total .sum')).toBeVisible()
    const sizes = await pair.evaluate((root) => {
      const box = (selector: string) => {
        const found = root.querySelector(selector)
        if (!found) throw new Error(`no ${selector}`)
        return found.getBoundingClientRect()
      }
      const answer = box('.total')
      const bars = box('.sum-card')
      return {
        answer: answer.height,
        bars: bars.height,
        sumAnswer: box('.total .sum').top - answer.top,
        sumBars: box('.sum-card .figure-line').top - bars.top,
      }
    })
    expect(sizes.sumBars).toBeCloseTo(sizes.sumAnswer, 0)
    expect(sizes.bars).toBeCloseTo(sizes.answer, 0)
  })

// The longest line of the record's total — a rate named with its bank, as the National Bank of Serbia
// asks, beside «С ценой — 12 из 14»: it wraps inside the card, never past it (MOL-206, review 2, №1:
// every part kept on one line, «rate … · National Bank of Serbia» stood past the card and the page
// scrolled sideways).
for (const width of [390, 320])
  test(`at ${String(width)} the record's total with a named rate stays inside its card`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 })
    await open(page, '/_kit')
    const card = page.locator('[data-part="trip-total-named"]')
    await expect(card.locator('.sum')).toBeVisible()
    const fits = await card.evaluate((root) => {
      const face = root.querySelector('.face')
      const box = root.getBoundingClientRect()
      const parts = [...root.querySelectorAll('.part')].map((part) => part.getBoundingClientRect())
      return {
        face: face ? face.scrollWidth <= face.clientWidth : false,
        parts: parts.every((part) => part.right <= box.right + 0.5),
        page: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      }
    })
    expect(fits).toEqual({ face: true, parts: true, page: true })
  })

// The receipt's line of the total (MOL-207, review №1): phrases with five-digit sums beside «≈» and the
// rate, and prices in two currencies, wrap between their words — never inside a word or a sum, never past
// the card. Made whole by no-break spaces, a phrase broke at any letter once past the card's width.
for (const locale of ['ru-RU', 'en-US'])
  test.describe(`the receipt's line of the total in ${locale}`, () => {
    test.use({ locale })
    for (const width of [390, 320])
      test(`at ${String(width)} wraps between words, inside its card`, async ({ page }) => {
        await page.setViewportSize({ width, height: 720 })
        await open(page, '/_kit')
        for (const name of ['trip-total-receipt', 'trip-total-currencies']) {
          const card = page.locator(`[data-part="${name}"]`)
          await expect(card.locator('.part').first()).toBeVisible()
          const fits = await card.evaluate((root) => {
            const box = root.getBoundingClientRect()
            const parts = [...root.querySelectorAll('.part')]
            // Each word — what an ordinary space parts — stands on one line: a word or a sum broken
            // across two has two boxes of its text.
            const broken: string[] = []
            for (const part of parts) {
              const text = part.firstChild
              if (text?.nodeType !== Node.TEXT_NODE) continue
              const value = text.textContent ?? ''
              let at = 0
              for (const word of value.split(' ')) {
                if (word) {
                  const range = document.createRange()
                  range.setStart(text, at)
                  range.setEnd(text, at + word.length)
                  const lines = new Set(
                    [...range.getClientRects()].map((rect) => Math.round(rect.top)),
                  )
                  if (lines.size > 1) broken.push(word)
                }
                at += word.length + 1
              }
            }
            return {
              parts:
                parts.length > 0 &&
                parts.every((part) => part.getBoundingClientRect().right <= box.right + 0.5),
              broken,
              page: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
            }
          })
          expect(fits, name).toEqual({ parts: true, broken: [], page: true })
        }
      })
  })

// The whole card is the flip (owner's В-17 «а»), in Chromium and WebKit alike: a tap anywhere on it
// turns the big number into the estimate, and says so by `aria-pressed`.
test("a tap on the record's total flips it to the estimate", async ({ page }) => {
  await open(page, '/_kit')
  const face = page.locator('[data-part="trip-total"] .face')
  await expect(face).toHaveAttribute('aria-pressed', 'false')
  await face.click()
  await expect(face).toHaveAttribute('aria-pressed', 'true')
  await expect(face.locator('.sum')).toHaveText(/^≈/)
  await face.click()
  await expect(face).toHaveAttribute('aria-pressed', 'false')
})

// The chips of a spending in two rows (MOL-198, self-review №2): the browser's measure is the frailest
// part of the task — fractional widths, the face, a chip that may shrink — and WebKit is the owner's
// phone. On the kit, signed out, so the iPhone's engine runs it too. Two rows of 44, «More…» last in
// the second, nothing past the field's edge. A row's height to the hundredth: at 13 (MOL-318) the rows
// stand at a fraction of a pixel, and a box read in the page's coordinates came 44.00006 once in 20.
for (const width of [390, 320])
  test(`at ${String(width)} the chips of a spending stand in two rows, «More…» last`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 })
    await open(page, '/_kit')
    const field = page.getByRole('group', { name: 'Category', exact: true })
    const rows = field.locator('.chips .row')
    await expect(rows).toHaveCount(2)
    for (const row of await rows.all()) expect((await row.boundingBox())?.height).toBeCloseTo(44, 2)
    await expect(rows.last().locator('> *').last()).toHaveText('More…')
    const edge = await field.evaluate((box) => box.getBoundingClientRect().right)
    const rights = await field
      .locator('.chips .chip')
      .evaluateAll((chips) => chips.map((chip) => chip.getBoundingClientRect().right))
    for (const right of rights) expect(right).toBeLessThanOrEqual(edge + 0.5)
  })

// MOL-304: an entry held its label on one line and gave its value half the row, so on a phone of 320
// «Перевод между счетами» ended in «…», and «Бюджет» beside «сверх плана 1 250 300 ֏» was «Бю…» with its
// figure cut too. Now nothing of an entry is cut: the label takes a second line, and a value that cannot
// stand beside its label goes under it, at the right — beside it while both fit, and a row of one line
// stays 52.
for (const locale of ['ru-RU', 'en-US'])
  test.describe(`an entry row in ${locale}`, () => {
    test.use({ locale })
    for (const width of [390, 320])
      test(`at ${String(width)} cuts neither its label nor its value`, async ({ page }) => {
        await page.setViewportSize({ width, height: 720 })
        await open(page, '/_kit')
        await expect(page.locator('.nav-row').first()).toBeVisible()
        const rows = await page.locator('.nav-row').evaluateAll((all) =>
          all
            .filter((row) => row.getClientRects().length > 0)
            .map((row) => {
              const label = row.querySelector<HTMLElement>('.label')!
              const value = row.querySelector<HTMLElement>('.value')
              const cut = (one: HTMLElement) =>
                one.scrollWidth > one.clientWidth || one.scrollHeight > one.clientHeight + 1
              const box = label.getBoundingClientRect()
              const lines = Math.round(box.height / parseFloat(getComputedStyle(label).lineHeight))
              const under = value ? value.getBoundingClientRect().top >= box.bottom - 1 : false
              return {
                text: label.textContent.trim(),
                height: row.getBoundingClientRect().height,
                lines,
                labelCut: cut(label),
                valueCut: value ? cut(value) : false,
                valueEnd: value
                  ? row.getBoundingClientRect().right - value.getBoundingClientRect().right
                  : null,
                under,
                inside:
                  (row.querySelector('.words')?.getBoundingClientRect().right ?? Infinity) <=
                  row.getBoundingClientRect().right,
              }
            }),
        )
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
        expect(rows.length).toBeGreaterThan(4)
        // A note longer than two lines ends in «…» after the second, inside its row (self-review №2: the
        // clamp of a box in a flex item is WebKit's riskiest place, and only Chromium opened the spending sheet).
        const note = rows.find((row) => /^(Вчера|Yesterday) · /.test(row.text))
        expect(note).toMatchObject({ lines: 2, labelCut: true, inside: true })
        for (const row of rows.filter((one) => one !== note))
          expect(row, row.text).toMatchObject({ labelCut: false, valueCut: false, inside: true })
        // A row of one line, its value beside it, is as tall as before — to the hundredth: a row stands on a
        // fractional pixel in CI's Chromium, 51.99976 and 52.00024 (as the chips' rows, MOL-318).
        for (const row of rows.filter((one) => one.lines === 1 && !one.under))
          expect(row.height, row.text).toBeCloseTo(52, 2)
        const transfer = rows.find((row) => /между счетами|between accounts/.test(row.text))
        const budget = rows.find((row) => /^(Бюджет|Budget)$/.test(row.text))
        const account = rows.find((row) => /^(Счёт|Account)$/.test(row.text))
        // At 320 the transfer's label breaks rather than ends in «…»; at 390 it stands on one line.
        expect(transfer?.lines).toBe(width === 320 ? 2 : 1)
        // A long figure goes under its label on a phone of 320, ending where a value beside one ends;
        // a short one stays beside.
        if (width === 320) expect(budget?.under).toBe(true)
        expect(account?.under).toBe(false)
        expect(budget?.valueEnd).toBeCloseTo(account?.valueEnd ?? 0, 0)
      })
  })

// MOL-318: a sheet's column took the least width of what stood in it — the chips' row with a long name of
// one's own first, a select as wide as its longest option, a title of one word — and a row's words took
// a till's line on one line; the sheet went past the phone, × and all. Nothing stands past the sheet's edge
// now, the chip and the line cut by their «…», in both engines: WebKit is the owner's phone.
test('at 320 names wider than the phone stand in a sheet, nothing past its edge', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await open(page, '/_kit')
  await page.getByRole('button', { name: 'Open a sheet of long names' }).click()
  const sheet = page.locator('dialog[open]')
  await expect(sheet).toContainText('Electroequipment')
  await page.waitForTimeout(400)
  const field = sheet.getByRole('group', { name: 'Category', exact: true })
  await expect(
    field.locator('.chips .row').first().getByRole('radio').first(),
  ).toHaveAccessibleName('Подарки родным и друзьям на дни рождения')
  const look = await sheet.evaluate((dialog) => {
    const edge = dialog.getBoundingClientRect().right
    const cut = (selector: string) => {
      const one = dialog.querySelector(selector)
      return one ? one.scrollWidth > one.clientWidth : null
    }
    const words = dialog.querySelector('.list-row .words')?.getBoundingClientRect().right ?? 0
    return {
      sideways: dialog.scrollWidth - dialog.clientWidth,
      past: [...dialog.querySelectorAll('*')]
        .filter((one) => !one.closest('.ruler-box'))
        .filter((one) => one.getBoundingClientRect().right > edge + 0.5)
        .map((one) => one.tagName + (typeof one.className === 'string' ? `.${one.className}` : '')),
      chip: cut('.chip.on .name'),
      line: cut('.printed'),
      lineInWords:
        (dialog.querySelector('.printed')?.getBoundingClientRect().right ?? Infinity) <=
        words + 0.5,
    }
  })
  expect(look).toEqual({ sideways: 0, past: [], chip: true, line: true, lineInWords: true })
  await expect(sheet.getByRole('button', { name: 'Close' })).toBeInViewport({ ratio: 1 })
})

/** The colour `--surface` computes to here, as a box-shadow prints it. */
function surfaceOf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.background = 'var(--surface)'
    document.body.append(probe)
    const colour = getComputedStyle(probe).backgroundColor
    probe.remove()
    return colour
  })
}

// Р-5 of MOL-198 (self-review №3): on the tint the dot of ten light categories fell under 3:1 (MOL-172
// А2), and on a ring of `surface` each holds it. Only the chosen one's dot has the ring — the chip's and
// the row's of «Category» — and the list opened by «More…» is a sheet over a sheet: «‹», no ×.
test('the chosen dot stands on a ring of surface; «More…» opens «Category» with «‹» and chooses', async ({
  page,
}) => {
  await open(page, '/_kit')
  const surface = await surfaceOf(page)
  const field = page.getByRole('group', { name: 'Category', exact: true })
  const shadow = (dot: Locator) => dot.evaluate((one) => getComputedStyle(one).boxShadow)
  const chosenDot = field.locator('.chip.on .dot')
  expect(await shadow(chosenDot)).toContain(surface)
  expect(await shadow(chosenDot)).toMatch(/0px 0px 0px 2px/)
  expect(await shadow(field.locator('.chip:not(.on) .dot').first())).toBe('none')

  await field.getByRole('button', { name: 'More…' }).click()
  const list = page.locator('dialog[open]')
  await expect(list).toContainText('Category')
  await expect(list.getByRole('button', { name: 'Back' })).toHaveCount(1)
  await expect(list.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)
  const chosenRow = list.getByRole('radio', { checked: true })
  expect(await shadow(chosenRow.locator('.dot'))).toContain(surface)
  expect(await shadow(list.getByRole('radio', { checked: false }).first().locator('.dot'))).toBe(
    'none',
  )

  // The list takes no tap while it rises.
  await page.waitForTimeout(400)
  await list.getByRole('radio', { name: 'Documents' }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  // Chosen from the list, it stands in the rows, checked (adversarial А1).
  await expect(field.getByRole('radio', { name: 'Documents' })).toBeChecked()
})

// A row of segments its words do not fit stands them one under another (MOL-321, owner's В-1 «а»):
// with Android's text at 150 % on a phone of 320 «Как меняли» took the exchange's sheet 121 px
// sideways, since a segment is never narrower than its word and the word is never broken (MOL-189,
// which no test held until now). The widest words a screen sets in one row, in both languages.
for (const locale of ['ru-RU', 'en-US'])
  test.describe(`a segmented row in ${locale}`, () => {
    test.use({ locale })
    test('stands one under another at 150 % on 320, every word whole, and back to a row', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 720 })
      await open(page, '/_kit')
      const name = locale === 'ru-RU' ? 'Как меняли' : 'How it was changed'
      const track = page.getByRole('group', { name }).locator('.track')
      await track.scrollIntoViewIfNeeded()
      const look = () =>
        track.evaluate((row) => {
          // A word on one line: broken, it has two boxes of its text. A word ends at a space or after a
          // hyphen of its own — «Non-|cash» breaks where print breaks it, not inside a word.
          const broken: string[] = []
          for (const word of row.querySelectorAll('.word')) {
            const text = word.firstChild
            if (text?.nodeType !== Node.TEXT_NODE) continue
            for (const part of (text.textContent ?? '').matchAll(/[^\s-]+-?/g)) {
              const range = document.createRange()
              range.setStart(text, part.index)
              range.setEnd(text, part.index + part[0].length)
              const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)))
              if (lines.size > 1) broken.push(part[0])
            }
          }
          const box = row.getBoundingClientRect()
          const segments = [...row.querySelectorAll('.segment')].map((one) =>
            one.getBoundingClientRect(),
          )
          return {
            broken,
            past: segments.filter((one) => one.right > box.right + 0.5).length,
            // The kit's page has wider things of its own at 150 %; the row is measured in itself.
            sideways: row.scrollWidth - row.clientWidth,
            full: segments.every((one) => Math.abs(one.width - segments[0]!.width) < 0.5),
          }
        })

      // Must not fire: at a text of 100 % the row fits a phone of 320.
      await expect(track).not.toHaveClass(/stacked/)
      expect(await look()).toMatchObject({ broken: [], past: 0, sideways: 0 })

      await page.evaluate(() => {
        document.documentElement.style.fontSize = '150%'
      })
      await expect(track).toHaveClass(/stacked/)
      const large = await look()
      expect(large).toMatchObject({ broken: [], past: 0, sideways: 0, full: true })
      // Each a whole 44 to the thumb.
      for (const segment of await track.locator('.segment').all())
        expect((await segment.boundingBox())!.height).toBeGreaterThanOrEqual(44)

      await page.evaluate(() => {
        document.documentElement.style.fontSize = ''
      })
      await expect(track).not.toHaveClass(/stacked/)
    })
  })

// A block button hyphenates its words only where the text is large (MOL-321, self-review №2): Safari
// knows no `hyphenate-limit-chars`, and WebKit hyphenates any word at a line's end — at 100 % «Сохранить
// из-менения». The style is read, not a hyphen drawn: Playwright's WebKit knows the limit, a phone's does not.
test('a block button hyphenates only with large text, never at 100 % on 320', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await open(page, '/_kit')
  const words = page.locator('.button.block').first()
  await expect(words).toBeAttached()
  const hyphens = () => words.evaluate((text) => getComputedStyle(text).hyphens)
  expect(await hyphens()).toBe('manual')
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '150%'
  })
  await expect.poll(hyphens).toBe('auto')
})
