import { describe, expect, it } from 'vitest'
import {
  armenianInRussian,
  lineFitter,
  newLineName,
  receiptLineParts,
} from '#model/entities/receipt-line-kind'

const WORDS = {
  յոգուրտ: 'йогурт',
  ելակ: 'клубника',
  դեղձ: 'персик',
  ըմպելի: 'питьевой',
  կաղամբի: 'капуста',
  չորաթթու: 'квашеная',
  ըմպելիք: 'напиток',
  գազավորված: 'газированный',
  թխվածքաբլիթ: 'печенье',
  վարունգ: 'огурец',
  ընտիր: 'отборный',
  կաթ: 'молоко',
  սուրճ: 'кофе',
  ընկույզ: 'орех',
  հավկիթ: 'яйцо',
  լոլիկ: 'помидор',
  պիցցայի: 'пицца',
  նեկտար: 'нектар',
  սև: 'чёрный',
  հաղարջ: 'смородина',
  հրուշակեղեն: 'кондитерские изделия/пирожное',
  ծովախեցգետին: 'креветка/краб',
  չիպս: 'чипсы',
}

const kind = (printed: string) => receiptLineParts(printed).kind
const fits = (printed: string, item: string) => lineFitter(receiptLineParts(printed), WORDS)(item)
const named = (printed: string) => newLineName(receiptLineParts(printed), WORDS)

describe('a line taken apart (MOL-293)', () => {
  it('finds the brand in «…», the fat and the package', () => {
    expect(receiptLineParts('Ըմպելի յոգուրտ «Մարիաննա» ելակ 1.5% 270գր')).toEqual({
      before: ['Ըմպելի', 'յոգուրտ'],
      brand: 'Մարիաննա',
      after: ['ելակ', '1.5%', '270գր'],
      kind: 'յոգուրտ',
      percent: '1,5%',
      size: '270 г',
    })
  })

  it('takes the head word before the brand, past adjectives, participles and the genitive', () => {
    expect(kind('Կաղամբի չորաթթու «Դայչա» 400գր')).toBe('չորաթթու')
    expect(kind('Պիցցայի լոշիկ «Պանո» 250±10գր')).toBe('լոշիկ')
    expect(kind('Գազավորված ըմպելիք «Ֆանտա» նարինջ 0.25լ')).toBe('ըմպելիք')
    expect(kind('Թարմ հավ «Արաքս» կգ')).toBe('հավ')
    expect(kind('Ծիածանափայլ իշխանի սթեյք սառեցված կգ')).toBe('սթեյք')
  })

  it('takes the first noun where the line prints no brand, and an abbreviation never', () => {
    expect(kind('Հաց Պումպերնիկել դդմի սերմով կգ')).toBe('Հաց')
    expect(kind('Ֆրանսիական հրուշակեղեն, հատապտղային կրեմով')).toBe('հրուշակեղեն')
    expect(kind('Գազ.ըմպելիք «Ֆրեշ Բար» կիվի միքս թ/տ 0.45լ')).toBe('ըմպելիք')
    expect(kind('16 Թև')).toBe('Թև')
  })

  it('takes a word of a case ending for the head where nothing else is', () => {
    expect(kind('Ֆրի ստանդարտ')).toBe('Ֆրի')
    expect(kind('Բուլկի կրեմով 90գր')).toBe('Բուլկի')
    expect(kind('Կուպատի «ԳԵԳ» կգ')).toBe('Կուպատի')
  })

  it('has no brand in a «…» with no letter, and a brand a till cut before its end', () => {
    expect(receiptLineParts('Իրիս «…» սերուցքային 140գր').brand).toBeNull()
    expect(receiptLineParts('Նուշ «22/24» կգ').brand).toBeNull()
    expect(receiptLineParts('Թխվածքաբլիթ «Ռոշեն Լովիտա').brand).toBe('Ռոշեն Լովիտա')
  })

  it('reads a brand printed first, and a line of figures, with no head word', () => {
    expect(receiptLineParts('«Կոկա Կոլա» 0.5լ')).toMatchObject({ brand: 'Կոկա Կոլա', kind: null })
    expect(receiptLineParts('1234 56').kind).toBeNull()
  })

  it('reads a package of several, a weight with its tolerance, and none for a line sold by weight', () => {
    expect(receiptLineParts('Բատոնչիկ «Սնիկերս» Սուպեր 2x40գր').size).toBe('2×40 г')
    expect(receiptLineParts('Շամպինիոն «Սպիտակ Գլխարկ» 0.3կգ').size).toBe('0,3 кг')
    expect(receiptLineParts('Գազար կգ').size).toBeNull()
    expect(receiptLineParts('Մագնեզիումի գլիցինատ 120մգ').size).toBeNull()
  })
})

describe('Armenian letters in Russian ones', () => {
  it('spells a brand as it crosses the border', () => {
    expect(armenianInRussian('Երեմյան Փրոդաքթս')).toBe('Еремян Продактс')
    expect(armenianInRussian('Ճաշկինո')).toBe('Чашкино')
    expect(armenianInRussian('Մախեև')).toBe('Махеев')
    expect(armenianInRussian('Ոսկեհավ')).toBe('Воскехав')
    expect(armenianInRussian('Գլավպրոդուկտ')).toBe('Главпродукт')
    expect(armenianInRussian('ԳԵԳ')).toBe('ГЕГ')
    expect(armenianInRussian('Coca-Cola')).toBe('Coca-Cola')
  })
})

describe('a new item’s name (MOL-293, В-1 «б»)', () => {
  it('is the kind, the brand in Russian letters, the flavour, the fat and the package', () => {
    expect(named('Յոգուրտ «Երեմյան Փրոդաքթս» ելակ 2% 130գր')).toEqual({
      name: 'Йогурт «Еремян Продактс» клубника 2% 130 г',
      spelled: false,
    })
    expect(named('Ըմպելի յոգուրտ «Մարիաննա» ելակ 1.5% 270գր')?.name).toBe(
      'Йогурт питьевой «Марианна» клубника 1,5% 270 г',
    )
  })

  it('puts the kind first, as a shelf names it', () => {
    expect(named('Կաղամբի չորաթթու «Դայչա» 400գր')?.name).toBe('Квашеная капуста «Дайча» 400 г')
  })

  it('spells in letters a word the dictionary has not, and says so (В-4)', () => {
    expect(named('Սուրճ «Լատինո» Մեդիում')).toEqual({
      name: 'Кофе «Латино» Медиум',
      spelled: true,
    })
  })

  it('takes a word exactly as the dictionary has it, never the nearest: «լոշիկ» is no tomato', () => {
    expect(named('Պիցցայի լոշիկ «Պանո»')).toEqual({ name: 'Лошик пицца «Пано»', spelled: true })
  })

  it('drops an abbreviation it cannot read, a unit, a count, a packaging mark and a repeat', () => {
    expect(named('Թխվածքաբլիթ անտ.ընկույզ ա/տ 10հտ')?.name).toBe('Печенье орех')
    expect(named('Հավկիթ «Արզնի» հավկիթ #0-1 10հտ')?.name).toBe('Яйцо «Арзни»')
  })

  it('takes a word’s first sense: «креветка/краб» is a shrimp', () => {
    expect(named('Չիպս «Մախեև» ծովախեցգետին 80գր')?.name).toBe('Чипсы «Махеев» креветка 80 г')
  })

  it('is none for a line with no word', () => {
    expect(named('1234 5.6')).toBeNull()
  })
})

describe('an item standing on a line (MOL-293, В-1 «а», В-2 «а»)', () => {
  const yoghurt = 'Յոգուրտ «Երեմյան Փրոդաքթս» ելակ 2% 130գր'

  it('takes the line’s own new name, and nothing that names a flavour, a fat or a package it has not', () => {
    expect(fits(yoghurt, 'Йогурт «Еремян Продактс» клубника 2% 130 г')).toBe(true)
    expect(fits(yoghurt, 'Йогурт «Еремян Продактс» персик 2% 130 г')).toBe(false)
    expect(fits(yoghurt, 'Йогурт «Еремян Продактс» клубника 1,5%')).toBe(false)
    expect(fits(yoghurt, 'Йогурт «Еремян Продактс» клубника 2% 270 г')).toBe(false)
  })

  it('never takes the fruit for a fruit yoghurt, nor an item without the line’s brand', () => {
    expect(fits(yoghurt, 'Клубника')).toBe(false)
    expect(fits(yoghurt, 'Йогурт')).toBe(false)
    expect(fits('Յոգուրտ ելակ', 'Йогурт')).toBe(true)
  })

  it('takes an item named by the brand alone, the brand compared across scripts (В-2 «а»)', () => {
    const cola = 'Գազավորված ըմպելիք «Կոկա Կոլա» 0.5լ'
    expect(fits(cola, 'Coca-Cola')).toBe(true)
    expect(fits(cola, 'Напиток газированный «Кока Кола»')).toBe(true)
    expect(fits(cola, 'Кола')).toBe(false)
    expect(fits(cola, 'Pepsi')).toBe(false)
  })

  it('takes the owner’s item of a line and no other of the brand', () => {
    const lovita = 'Թխվածքաբլիթ «Ռոշեն» Լովիտա, ելակ 135գր'
    expect(fits(lovita, 'Печенье Roshen Lovita, клубника')).toBe(true)
    expect(fits(lovita, 'Печенье Roshen Lovita, малина')).toBe(false)
    expect(fits('Թխվածքաբլիթ «Ճաշկինո» բալ 137գր', 'Печенье Roshen Lovita, клубника')).toBe(false)
  })

  it('takes an item of the kind with no more than the line prints, a Russian ending apart', () => {
    expect(fits('Վարունգ ընտիր կգ', 'Огурцы')).toBe(true)
    expect(fits('Վարունգ ընտիր կգ', 'Огурцы отборные')).toBe(true)
    expect(fits('Վարունգ ընտիր կգ', 'Огурцы маринованные')).toBe(false)
    expect(fits('Կաթ 3.2% 1լ', 'Молоко 3,2%')).toBe(true)
    expect(fits('Կաթ 3.2% 1լ', 'Молоко 2,5%')).toBe(false)
  })

  it('reads the kind by any of its senses, and «և» either way it is spelt', () => {
    expect(fits('Ֆրանսիական հրուշակեղեն, հատապտղային կրեմով', 'Пирожные')).toBe(true)
    expect(fits('Նեկտար «Սիս» սև հաղարջ 1.6լ', 'Нектар «Сис» чёрная смородина')).toBe(true)
    expect(fits('Նեկտար «Սիս» սեվ հաղարջ 1.6լ', 'Нектар «Сис» чёрная смородина')).toBe(true)
  })

  it('gives a line whose kind the dictionary has not nothing but its brand', () => {
    const dessert = 'Աղանդեր «Դոն Դանտես» 130գր'
    expect(fits(dessert, 'Десерт «Дон Дантес»')).toBe(false)
    expect(fits(dessert, 'Дон Дантес')).toBe(true)
  })

  it('takes nothing for a name of no word', () => {
    expect(fits(yoghurt, '')).toBe(false)
    expect(fits(yoghurt, 'для')).toBe(false)
  })
})
