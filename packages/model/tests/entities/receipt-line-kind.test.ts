import { describe, expect, it } from 'vitest'
import {
  armenianInRussian,
  lineFitter,
  newLineName,
  receiptLineParts,
  seedNameFits,
} from '#model/entities/receipt-line-kind'
import { receiptWords } from '#model/entities/receipt-match'

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
  լյարդ: 'печень',
  ատամի: 'зуб',
  պաստա: 'паста',
  չերի: 'черри',
  բատոնչիկ: 'батончик',
  սիռոկ: 'сырок',
  սերուցք: 'сливки',
  կիտրոն: 'лимон',
  նուռ: 'гранат',
  շամպինիոն: 'шампиньон',
  համեմ: 'кинза',
  խորոված: 'шашлык',
  խոզի: 'свиной',
  կեֆիր: 'кефир',
  ձիթապտղի: 'оливки',
  մայոնեզ: 'майонез',
  հյութ: 'сок',
  մասուր: 'шиповник',
  երշիկ: 'колбаса',
  չորիզո: 'чоризо',
  ազնվամորու: 'малина',
  մուրաբա: 'варенье',
  լոբու: 'фасоль',
  ապուր: 'суп',
  ձկան: 'рыба',
  յուղ: 'масло',
  գինու: 'вино',
  բաժակ: 'стакан',
  նռան: 'гранат',
  միջին: 'средний',
  պանիր: 'сыр',
  չեդդեր: 'чеддер',
  պաղպաղակ: 'мороженое',
  մարտկոց: 'батарейка',
  սուպեր: 'супер',
  ձեռնոց: 'перчатки',
}

const kind = (printed: string) => receiptLineParts(printed).kind
const fits = (printed: string, item: string, generic = false) =>
  lineFitter(receiptLineParts(printed), WORDS)(item, { generic })
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

  it('takes «խորոված», a shashlik, for the head: no adjective of its ending (adversarial А4)', () => {
    expect(kind('Խորոված խոզի կգ')).toBe('Խորոված')
    expect(fits('Խորոված խոզի կգ', 'Свинина')).toBe(false)
  })

  it('keeps the text of a «…» with no letter a word of the line: «22/24»', () => {
    expect(receiptLineParts('Նուշ «22/24» կգ').before).toEqual(['Նուշ', '22/24', 'կգ'])
  })

  it('takes a word of a case ending for the head where nothing else is', () => {
    expect(kind('Ֆրի ստանդարտ')).toBe('Ֆրի')
    expect(kind('Բուլկի կրեմով 90գր')).toBe('Բուլկի')
    expect(kind('Կուպատի «ԳԵԳ» կգ')).toBe('Կուպատի')
  })

  it('takes a genitive in «-ու» or «-ան» for no head, a nominative of that end where nothing else is (review 2, №2)', () => {
    expect(kind('Ազնվամորու մուրաբա')).toBe('մուրաբա')
    expect(kind('Գինու քացախ')).toBe('քացախ')
    expect(kind('Ձկան յուղ')).toBe('յուղ')
    expect(kind('Նռան հյութ')).toBe('հյութ')
    expect(kind('Կաղամբի չորաթթու')).toBe('չորաթթու')
    // «ձու» is too short for a genitive, a unit no word
    expect(kind('Ձու հավի')).toBe('Ձու')
    expect(kind('Թուզ կգ')).toBe('Թուզ')
    // «հող», soil, is no participle in «-ող»
    expect(kind('ՏՈՖՈՒ ՀՈՂ ԴԵՂՁ 6լ(հատ)')).toBe('ՀՈՂ')
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

describe('a name of the seed in the till’s language for the line’s kind (MOL-293, adversarial А1)', () => {
  const name = (hy: string) => receiptWords(hy)
  const says = (printed: string, hy: string, dictionary: Record<string, string> = WORDS) =>
    seedNameFits(receiptLineParts(printed), name(hy), dictionary)

  it('takes the seed’s own name that says the kind, inflected past it', () => {
    expect(says('Ատամի պաստա', 'ատամի պաստա')).toBe(true)
    expect(says('Ֆրանսիական հրուշակեղեն', 'հրուշակ')).toBe(true)
    expect(says('Կոնֆետներ', 'կոնֆետ')).toBe(true)
    expect(says('Կուս-կուս', 'կուս-կուս')).toBe(true)
  })

  it('takes no name without the kind, and none for a branded line', () => {
    expect(says('Յոգուրտ ելակի', 'ելակ')).toBe(false)
    expect(says('Կաթ «Իգիթ» 3.2%', 'կաթ')).toBe(false)
  })

  it('takes no name whose word only starts as the kind does (adversarial Б3)', () => {
    expect(says('Տուշ թարթիչների', 'տուշոնկա')).toBe(false)
    expect(says('Թել կարի', 'թելիկ')).toBe(false)
    expect(says('Հավի վերևի մաս', 'մասլինա')).toBe(false)
    expect(says('Դեղ գլխացավի', 'դեղձ')).toBe(false)
  })

  it('forgives a letter lost of a word the dictionary has not, never one misread (adversarial Б4)', () => {
    expect(says('Սուս չիլի', 'սոուս չիլի')).toBe(true)
    expect(says('Կոլասա եփած', 'կոլբասա եփած')).toBe(true)
    expect(says('Կոլասա եփած', 'կոլա')).toBe(false)
    expect(says('Ռոլիկ', 'լոլիկ')).toBe(false)
    // «լոշիկ», a flat bread, is a word of its own and one letter from a tomato
    expect(says('Պիցցայի լոշիկ', 'լոլիկ', { ...WORDS, լոշիկ: 'лепёшка' })).toBe(false)
  })

  it('takes for two things side by side only a name that says both (adversarial Б1)', () => {
    expect(says('Ելակ յոգուրտ', 'ելակ')).toBe(false)
    expect(says('Ելակ յոգուրտ', 'յոգուրտ')).toBe(false)
    expect(says('Յոգուրտ ելակ', 'յոգուրտ')).toBe(false)
    expect(says('Յոգուրտ ելակ', 'յոգուրտ ելակի')).toBe(true)
    // a quality is no thing: «Լոլիկ միջին» is a tomato
    expect(says('Լոլիկ միջին', 'լոլիկ')).toBe(true)
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

  it('drops a lone sign before a figure, and writes a word in capitals as a word (review №5)', () => {
    expect(named('Չիպս x 24')?.name).toBe('Чипсы')
    expect(named('ԸՆԴԱԼԹ ՉԻՊՍ')?.name).toBe('Ындалт чипсы')
    // an abbreviation keeps its capitals, a size its letter (review 2, №3)
    expect(named('Մարտկոց «Էներջի» Սուպեր ԱԱ')?.name).toBe('Батарейка «Энерджи» супер АА')
    expect(named('Ձեռնոց «Վերդե Վիտա» M')?.name).toBe('Перчатки «Верде Вита» M')
    expect(named('Պաղպաղակ «Թամարա» ԳՕՍՏ')?.name).toBe('Мороженое «Тамара» ГОСТ')
    expect(named('ԴԱՐԱՆ ԿԼԵՅ')?.name).toBe('Даран клей')
    expect(named('Կուպատի «ԳԵԳ» կգ')?.name).toBe('Купати «ГЕГ»')
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
    expect(fits('Յոգուրտ ելակի', 'Йогурт')).toBe(true)
  })

  it('takes for two things side by side only an item that says both (adversarial Б1)', () => {
    for (const printed of ['Ելակ յոգուրտ', 'Յոգուրտ ելակ']) {
      expect(fits(printed, 'Клубника')).toBe(false)
      expect(fits(printed, 'Йогурт')).toBe(false)
      expect(fits(printed, 'Йогурт клубничный')).toBe(true)
    }
    expect(fits('Ելակ պաղպաղակ', 'Клубника')).toBe(false)
    expect(fits('Պանիր չեդդեր', 'Сыр чеддер')).toBe(true)
    expect(fits('Պանիր չեդդեր', 'Сыр')).toBe(false)
  })

  it('never takes the thing of a genitive in «-ու» or «-ան» for the kind (review 2, №2)', () => {
    const pairs: [string, string][] = [
      ['Ազնվամորու մուրաբա', 'Малина'],
      ['Լոբու ապուր', 'Фасоль'],
      ['Ձկան յուղ', 'Рыба'],
      ['Գինու բաժակ', 'Вино'],
      ['Նռան հյութ', 'Гранат'],
    ]
    for (const [printed, item] of pairs) expect(fits(printed, item, true), printed).toBe(false)
    expect(fits('Ազնվամորու մուրաբա', 'Варенье', true)).toBe(true)
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

  it('never takes another thing by a common start or one edit (adversarial А1, А3, review №2)', () => {
    const pairs: [string, string][] = [
      ['Լյարդ', 'Печенье'],
      ['Ատամի պաստա', 'Пастила'],
      ['Չերի', 'Черника'],
      ['Բատոնչիկ', 'Батон'],
      ['Սիռոկ', 'Сироп'],
      ['Սերուցք', 'Сливы'],
      ['Կիտրոն', 'Лимонад'],
      ['Նուռ', 'Гранола'],
      ['Շամպինիոն 0.5կգ', 'Шампунь'],
      ['Համեմ հտ', 'Киноа'],
      ['Ֆրանսիական հրուշակեղեն, հատապտղային կրեմով', 'Пирожки'],
    ]
    for (const [printed, other] of pairs)
      expect(fits(printed, other), `${printed} → ${other}`).toBe(false)
  })

  it('takes a word in its forms: a plural, a case, the adjective a noun makes', () => {
    expect(fits('Լյարդ', 'Печень')).toBe(true)
    expect(fits('Ատամի պաստա', 'Паста зубная')).toBe(true)
    expect(fits('Հյութ «Արտֆուդ» մասուր 250մլ', 'Сок шиповника «Артфуд»')).toBe(true)
    expect(fits('Մայոնեզ «Սլոբոդա» ձիթապտղի 67% 400մլ', 'Майонез «Слобода» оливковый 67%')).toBe(
      true,
    )
    expect(fits('Կիտրոն', 'Лимоны')).toBe(true)
  })

  it('never takes the seed’s item, a kind, for a branded line: «Бекон» for a sausage of «Բեկոն»', () => {
    const chorizo = 'Երշիկ չորիզո «Բեկոն» 192գր'
    expect(fits(chorizo, 'Бекон', true)).toBe(false)
    expect(fits(chorizo, 'Колбаса чоризо «Бекон»')).toBe(true)
    expect(fits('Մարտկոց «Էներջի» 4հտ', 'Энергетик', true)).toBe(false)
  })

  it('reads a figure with its unit: a fat is never a litre (adversarial А5)', () => {
    const kefir = 'Կեֆիր «Մարիաննա» 2.5% 1լ'
    expect(fits(kefir, 'Кефир «Марианна» 1%')).toBe(false)
    expect(fits(kefir, 'Кефир «Марианна» 2,5%')).toBe(true)
    expect(fits(kefir, 'Кефир «Марианна» 2,5% 1 л')).toBe(true)
  })

  it('takes nothing for a name of no word', () => {
    expect(fits(yoghurt, '')).toBe(false)
    expect(fits(yoghurt, 'для')).toBe(false)
  })
})
