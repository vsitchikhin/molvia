import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { OffError, parseProduct } from './product'
import type { OffAnswer } from './product'

// Answers recorded from world.openfoodfacts.org on 01.10.2026, byte for byte.
function fixture(name: string): string {
  return readFileSync(
    new URL(`../../tests/fixtures/open-food-facts/${name}`, import.meta.url),
    'utf8',
  )
}

function answer(product: Record<string, unknown>): string {
  return JSON.stringify({ code: '4600000000003', product, status: 1 })
}

function found(text: string): Extract<OffAnswer, { found: true }>['product'] {
  const parsed = parseProduct(text)
  if (!parsed.found) throw new Error('expected a product')
  return parsed.product
}

describe('записанные ответы', () => {
  it('Nutella: французский продукт — русскому интерфейсу английское имя, бренд уже в имени, 400 г — 0,4 кг', () => {
    expect(found(fixture('nutella.json'))).toEqual({
      names: { ru: 'Nutella', en: 'Nutella' },
      quantity: { milli: 400n, unit: 'kg' },
    })
  })

  it('Coca-Cola: своё имя на каждом языке; бренд «COCA-COLA SERVICES» не дописан — его слово в имени', () => {
    expect(found(fixture('coca-cola.json'))).toEqual({
      names: { ru: 'Coca Cola', en: 'Coca-Cola' },
      quantity: { milli: 330n, unit: 'l' },
    })
  })

  it('неизвестный код — 404 со status 0 — не найден', () => {
    expect(parseProduct(fixture('unknown.json'))).toEqual({ found: false })
  })

  it('код из нулей — 200 со status 0 — тоже не найден, а не сбой', () => {
    expect(parseProduct(fixture('invalid.json'))).toEqual({ found: false })
  })

  it('HTML «Page temporarily unavailable» — база недоступна, а не промах', () => {
    expect(() => parseProduct(fixture('unavailable.html'))).toThrow(OffError)
  })
})

describe('чужая форма ответа — сбой, не промах', () => {
  it.each([
    ['массив', '[]'],
    ['status 1 без продукта', '{"status":1}'],
    ['status строкой', '{"status":"1","product":{}}'],
    ['без status', '{"product":{"product_name":"Кефир"}}'],
    ['продукт массивом', '{"status":1,"product":[]}'],
  ])('%s', (_case, text) => {
    expect(() => parseProduct(text)).toThrow(OffError)
  })
})

describe('имя', () => {
  it('продукт на русском — его главное имя раньше английского; английскому — английское', () => {
    expect(
      found(answer({ lang: 'ru', product_name: 'Кефир 1%', product_name_en: 'Kefir 1%' })).names,
    ).toEqual({ ru: 'Кефир 1%', en: 'Kefir 1%' })
  })

  it('главное имя на чужом языке уступает английскому', () => {
    expect(
      found(answer({ lang: 'de', product_name: 'Milch', product_name_en: 'Milk' })).names,
    ).toEqual({ ru: 'Milk', en: 'Milk' })
  })

  it('нет ни своего, ни английского — главное имя, на каком есть', () => {
    expect(found(answer({ lang: 'hy', product_name: 'Կաթ' })).names).toEqual({
      ru: 'Կաթ',
      en: 'Կաթ',
    })
  })

  it('только русское имя — английскому интерфейсу тоже оно: лучше, чем ничего', () => {
    expect(found(answer({ product_name_ru: 'Ряженка' })).names).toEqual({
      ru: 'Ряженка',
      en: 'Ряженка',
    })
  })

  it('пустое своё имя пропускается, а не выигрывает', () => {
    expect(found(answer({ product_name_ru: '  ', product_name_en: 'Kefir' })).names.ru).toBe(
      'Kefir',
    )
  })

  it('HTML-сущности раскрываются: &quot;, &amp;, числовые', () => {
    expect(
      found(answer({ product_name_ru: 'Сметана &quot;Ашхар&quot; &amp; Co &#8470;1 &#x2014; 20%' }))
        .names.ru,
    ).toBe('Сметана "Ашхар" & Co №1 — 20%')
  })

  it('неизвестная сущность и сущность вне Юникода остаются текстом', () => {
    expect(found(answer({ product_name_ru: 'Сыр &foo; &#xD800; &#99999999;' })).names.ru).toBe(
      'Сыр &foo; &#xD800; &#99999999;',
    )
  })

  it('переносы и табы — одна строка, пробелы схлопнуты', () => {
    expect(found(answer({ product_name_ru: ' Сыр\n\tГауда   45% ' })).names.ru).toBe(
      'Сыр Гауда 45%',
    )
  })

  it('длиннее имени позиции — обрезано до двухсот знаков, а не отвергнуто', () => {
    const name = found(answer({ product_name_ru: `Сыр ${'я'.repeat(300)}` })).names.ru
    expect(Array.from(name)).toHaveLength(200)
    expect(name.startsWith('Сыр я')).toBe(true)
  })

  it.each([
    ['код вместо имени', '4850001270129'],
    ['одна буква', 'x'],
    ['только знаки', '--- 100%'],
    ['пусто', ''],
    ['число', 42],
  ])('мусор — не подсказка: %s', (_case, name) => {
    expect(parseProduct(answer({ product_name: name }))).toEqual({ found: false })
  })

  it.each([
    ['символ частной области', 'Apple \uf8ff juice', 'Apple juice'],
    ['сущность частной области', 'Молоко&#xE000; 3,2%', 'Молоко 3,2%'],
    ['одинокий суррогат', 'Кефир \ud800 1%', 'Кефир 1%'],
  ])('%s вырезается, а не губит имя (адверсариальный Ж)', (_case, name, expected) => {
    expect(found(answer({ product_name_ru: name })).names.ru).toBe(expected)
  })

  it('«test2» проходит: правило под каждую порчу не пишется, имя правит человек (Р-9)', () => {
    expect(found(answer({ product_name: 'test2' })).names.ru).toBe('test2')
  })

  it('продукт без имени вовсе — не найден', () => {
    expect(parseProduct(answer({ brands: 'Ашхар', product_quantity: 400 }))).toEqual({
      found: false,
    })
  })
})

describe('бренд (Р-3)', () => {
  it('первый бренд дописывается, если его нет в имени', () => {
    expect(
      found(answer({ product_name_ru: 'Молоко 3,2%', brands: 'Простоквашино, Danone' })).names.ru,
    ).toBe('Молоко 3,2% Простоквашино')
  })

  it('бренд латиницей в имени кириллицей — тот же по ключу поиска, не дописан', () => {
    expect(
      found(answer({ product_name_ru: 'Молоко Prostokvashino', brands: 'Простоквашино' })).names.ru,
    ).toBe('Молоко Prostokvashino')
  })

  it.each([
    [
      'артикль короче трёх букв — не бренд',
      'Yaourt à la vanille',
      'La Laitière',
      'Yaourt à la vanille La Laitière',
    ],
    [
      'марка из бренда в имени — без юрлица',
      'Сыр Савушкин 45%',
      'Савушкин продукт',
      'Сыр Савушкин 45%',
    ],
    ['марка в имени — без страны', 'Danone Активиа', 'Danone Россия', 'Danone Активиа'],
    ['марка в конце имени', 'Творожок Агуша', 'Агуша Россия', 'Творожок Агуша'],
    ['бренд из коротких слов', 'Печенье LU', 'LU', 'Печенье LU'],
  ])(
    'бренд в имени — любое его слово от трёх букв (адверсариальные В, В′): %s',
    (_case, name, brands, expected) => {
      expect(found(answer({ product_name_ru: name, brands })).names.ru).toBe(expected)
    },
  )

  it.each([
    ['Печенье для чая', 'Всё для дома', 'Печенье для чая Всё для дома'],
    ['Confiture des Vosges', 'Les Délices des Bois', 'Confiture des Vosges Les Délices des Bois'],
    ['Biscuits for tea', 'Made for You', 'Biscuits for tea Made for You'],
  ])(
    'служебное слово короче четырёх букв — не бренд (адверсариальный В″): «%s» + «%s»',
    (name, brands, expected) => {
      expect(found(answer({ product_name_ru: name, brands })).names.ru).toBe(expected)
    },
  )

  it.each([
    ['Напиток 7Up', '7Up'],
    ['Сок J7 апельсин', 'J7'],
    ['Конфеты KDV', 'KDV Group'],
    ['Сахарозаменитель Fit', 'Fit Parade'],
    ['Вода Bon Aqua', 'Bon Aqua'],
  ])(
    'марка с цифрой или трёхбуквенная перед юрлицом — в имени, не удваивается (адверсариальный В‴): «%s» + «%s»',
    (name, brands) => {
      expect(found(answer({ product_name_ru: name, brands })).names.ru).toBe(name)
    },
  )

  it('цена правила: бренд, чьё слово совпало с сортом в имени, теряется', () => {
    expect(
      found(answer({ product_name_ru: 'Сыр Российский', brands: 'Российский сыродел' })).names.ru,
    ).toBe('Сыр Российский')
  })

  it('бренд-мусор не дописывается', () => {
    expect(found(answer({ product_name_ru: 'Молоко', brands: '123, Danone' })).names.ru).toBe(
      'Молоко',
    )
  })

  it('имя, которое бренд увёл бы за предел, остаётся без бренда', () => {
    const long = `Сыр ${'я'.repeat(195)}`
    expect(found(answer({ product_name_ru: long, brands: 'Ашхар' })).names.ru).toBe(long)
  })
})

describe('объём (Р-4)', () => {
  it.each([
    [500, 'g', { milli: 500n, unit: 'kg' }],
    ['500', 'g', { milli: 500n, unit: 'kg' }],
    [1.5, 'l', { milli: 1500n, unit: 'l' }],
    [75, 'cl', { milli: 750n, unit: 'l' }],
    [5, 'dl', { milli: 500n, unit: 'l' }],
    [2, 'KG', { milli: 2000n, unit: 'kg' }],
    [330, ' ml ', { milli: 330n, unit: 'l' }],
  ])('%s %s', (value, unit, quantity) => {
    expect(
      found(answer({ product_name: 'Кефир', product_quantity: value, product_quantity_unit: unit }))
        .quantity,
    ).toEqual(quantity)
  })

  it.each([
    ['штуки', 6, 'pcs'],
    ['унции', 12, 'oz'],
    ['ноль', 0, 'g'],
    ['отрицательный', -400, 'g'],
    ['меньше грамма', 0.5, 'g'],
    ['больше пятидесяти килограммов', 400000, 'g'],
    ['текст', '400 g', 'g'],
    ['без единицы', 400, undefined],
    ['без числа', undefined, 'g'],
    ['бесконечность', Infinity, 'g'],
  ])('без объёма: %s', (_case, value, unit) => {
    expect(
      found(answer({ product_name: 'Кефир', product_quantity: value, product_quantity_unit: unit }))
        .quantity,
    ).toBeNull()
  })
})
