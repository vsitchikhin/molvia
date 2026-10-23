import { describe, expect, it } from 'vitest'
import { linePack, packedQuantity, receiptPack } from '#model/entities/receipt-pack'
import type { Quantity } from '#model/values/units'

const kg = (grams: number): Quantity => ({ milli: BigInt(grams), unit: 'kg' })
const l = (millilitres: number): Quantity => ({ milli: BigInt(millilitres), unit: 'l' })
const pieces = (count: number): Quantity => ({ milli: BigInt(count) * 1000n, unit: 'piece' })

describe('receiptPack — an Armenian till', () => {
  it.each([
    ['Գազավորված ըմպելիք «Կոկա Կոլա» 1.5լ', l(1500)],
    ['Հավի թարմ թոք «Աշտարակ» ափսեով 950գր', kg(950)],
    ['Հավի ազդր «Արաքս» 1կգ', kg(1000)],
    ['Մայոնեզ «Սլոբոդա» ձիթապտղի 67% 400մլ', l(400)],
    ['Սուրճ աղացած «Կաֆֆա» Առավոտ, ռոբուստա 100գ', kg(100)],
    ['Ջուր «Ջերմուկ» 0,5լ', l(500)],
  ])('reads a size: %s', (printed, pack) => {
    expect(receiptPack(printed, 'AM')).toEqual(pack)
  })

  it.each([
    ['Պիցցայի լոշիկ «Պանո» 250±10գր', kg(250)],
    ['Հաց «Սևանի» ամբողջահատիկ ցորենից 470գր±3%', kg(470)],
  ])('reads past a tolerance: %s', (printed, pack) => {
    expect(receiptPack(printed, 'AM')).toEqual(pack)
  })

  it.each([
    ['Հյութ «Արտֆուդ» 3х200մլ', l(600)],
    ['Բատոնչիկ «Սնիկերս» Սուպեր 2x40գր', kg(80)],
    ['Թեյ կանաչ «Գրինֆիլդ» Գրին Մելիսսա 25x2գր', kg(50)],
    ['Կոճակ զուգարանի 15գ*8', kg(120)],
  ])('multiplies a pack of N: %s', (printed, pack) => {
    expect(receiptPack(printed, 'AM')).toEqual(pack)
  })

  it.each([
    ['Հավկիթ «Ոսկեհավ» #0-1 10հտ', pieces(10)],
    ['Չոր վառելիք «Բոյսքաութ» 5հատ 61533', pieces(5)],
    ['Թուղթ զուգարանի Neva 12հ 3շ', pieces(12)],
    ['Մարտկոց «Էներջի» Սուպեր ԱԱ 1.5Վ 4հտ', pieces(4)],
    // the model's copies: «հ» as a Latin «h», «հատ» as «հաբ»
    ['Մարտոց «Էվրոլի» Սուլեր ԱՄ 1.5/4hտ', pieces(4)],
    ['Չոր վառելիք «Բոյսքոռությ» 5հաբ 61533', pieces(5)],
    ['Сет Ронин 32шт(1кг)', pieces(32)],
  ])('reads a pack of pieces: %s', (printed, pack) => {
    expect(receiptPack(printed, 'AM')).toEqual(pack)
  })

  it.each([
    ['Աղբի պարկեր «Ֆրեկեն Բոկ» 35լ 30հտ', pieces(30)],
    ['Բաժակ թղթե «Էկո Փեյփր» 330մլ, 5հտ', pieces(5)],
  ])('takes the pieces over what one holds (Р-3): %s', (printed, pack) => {
    expect(receiptPack(printed, 'AM')).toEqual(pack)
  })

  it('takes the size by its unit, never a fat, a strength or a year', () => {
    expect(receiptPack('Կաթ «Իգիթ» 3.2% 1լ', 'AM')).toEqual(l(1000))
    expect(receiptPack('Քացախ խնձորի «Արտֆուդ» 4.2% 470մլ', 'AM')).toEqual(l(470))
    expect(receiptPack('Կոնյակ «Նոյ» ընծայական 5տ (տուփով) 0.5լ', 'AM')).toEqual(l(500))
    expect(receiptPack('Մակարոն-ժապավեն «Բարիլլա» մինի №59 500գր', 'AM')).toEqual(kg(500))
    expect(receiptPack('Սուրճ լուծվող «Մակ Կոֆե» թունդ 3-ը 1-ում 18գր', 'AM')).toEqual(kg(18))
  })

  it.each([
    ['Սերուցք «Իգիթ» 10%'],
    ['Թղթապատույթ «Ֆինո» 39սմ 5մ 2439'],
    ['Պարացետամոլ դհտ 500մգ x 20'],
    ['Մարտկոց «Էներջի» 1.5Վ'],
    // a size the till cut: no unit, no package
    ['Շոկոլադե սալիկ «Ռոշեն» ծակոտկեն, էքստրա սև 85'],
    ['Այրեցնող հեղուկ «Հոթ փոթ» ածխաջրածնային 0.5'],
    // the till's own count, never a pack
    ['Փախլավա շերտավոր երևանյան 1հտ'],
    // «1 լոլիկ» is a tomato, not a litre
    ['Լոլիկ 1 լոլիկ'],
  ])('reads no package where none is printed: %s', (printed) => {
    expect(receiptPack(printed, 'AM')).toBeNull()
  })

  it('reads none on a line that prints a thickness: packaging holds its litres (Р-11)', () => {
    expect(receiptPack('Պոլիէթիլենային տոպրակ «Երևան Սիթի» 60միկրոն,Մ', 'AM')).toBeNull()
    expect(receiptPack('Տոպրակ աղբի 35լ 50միկրոն', 'AM')).toBeNull()
  })

  it('reads none where two sizes disagree, one where they agree', () => {
    expect(receiptPack('Մածուն 500գր 1կգ', 'AM')).toBeNull()
    expect(receiptPack('Մածուն 500գր 500գր', 'AM')).toEqual(kg(500))
    expect(receiptPack('Անձեռոցիկ 75հ 100հ', 'AM')).toBeNull()
  })

  it('doubts a size with a 6 read off a photo: the font prints 5 as 6 (MOL-290)', () => {
    expect(receiptPack('Գազավորված ըմպելիք «Կոկա Կոլա» 1.6լ', 'AM')).toBeNull()
    expect(receiptPack('Պիցցայի լոշիկ «Պիկանտ համ» 260±10գր', 'AM')).toBeNull()
    expect(receiptPack('Հյութ 6x200մլ', 'AM')).toBeNull()
    // a 6 elsewhere on the line is no doubt of the size
    expect(receiptPack('Սոսինձ «Սիլա» 605 5գր', 'AM')).toEqual(kg(5))
  })

  it('reads an Armenian unit only glued to its figure: «505 գր» lost the 6 of «505 6գր»', () => {
    expect(receiptPack('Սուլեր տուփին «Միլա» 505 գր', 'AM')).toBeNull()
  })

  it('reads none past what a package holds: «330լ» is a can with its point lost', () => {
    expect(receiptPack('Ըմպելիք «Ֆանտա» թ/տ 330լ', 'AM')).toBeNull()
    expect(receiptPack('Ջուր «Բջնի» 19լ', 'AM')).toEqual(l(19_000))
    expect(receiptPack('Կեր կատվի 20կգ', 'AM')).toEqual(kg(20_000))
    expect(receiptPack('Կեր կատվի 51կգ', 'AM')).toBeNull()
  })

  it('takes a star before a size as no count: «3*» is a cognac’s stars (review №1)', () => {
    expect(receiptPack('Կոնյակ «Արարատ» 3* 0.5լ', 'AM')).toEqual(l(500))
    expect(receiptPack('Կոնյակ «Արարատ» 5* 0.7լ', 'AM')).toEqual(l(700))
    expect(receiptPack('Կոճակ զուգարանի 15գ*8', 'AM')).toEqual(kg(120))
    // glued to both figures it is a count's sign with its count unread: none
    expect(receiptPack('Թեյ 25*2գր', 'AM')).toBeNull()
  })

  it.each([
    // a range: a nappy for a child of 9 to 14 kg (review №2)
    ['Տակդիր «Pampers» N4 9-14կգ'],
    ['Տակդիր «Pampers» N4 9–14կգ'],
    // a fraction: its denominator is no size (adversarial А3)
    ['Խմոր շերտավոր «Արտֆուդ» 1/2կգ'],
    // a multiplier whose count is a word: one sachet of a box (adversarial А4)
    ['Чай «Greenfield» Golden Ceylon 25пак*2г'],
    ['Թեյ «Գրինֆիլդ» 25 փաթեթ x 2գր'],
    ['Թեյ «Ահմադ» 25փթ*2գ'],
    // a vintage, a nappy's size, a unit apart from its figure on a photo (adversarial А5)
    ['Գինի «Արենի» 2019г'],
    ['Вино «Арени» красное сухое 2019 г'],
    ['Տակդիր «Pampers» Active Baby Maxi 4 L'],
  ])('reads none where what stands before a size says it is not one: %s', (printed) => {
    expect(receiptPack(printed, 'AM')).toBeNull()
  })

  it('takes a pack of pieces past a range, and a times sign that ends no word', () => {
    expect(receiptPack('Տակդիր «Pampers» N4 9-14կգ 52հտ', 'AM')).toEqual(pieces(52))
    expect(receiptPack('Elixir mix 0.33l', 'AM')).toEqual(l(330))
  })

  it('reads «× N» after a pack of pieces as packs or plies unread: none, never four (adversarial А5, review 5)', () => {
    expect(receiptPack('Թուղթ զուգարանի «Զևա» 4հ x 2', 'AM')).toBeNull()
  })

  it('doubts a count with a 6 read off a photo, as a size (adversarial А2, review №4)', () => {
    expect(receiptPack('Հավկիթ «Ոսկեհավ» 16հտ', 'AM')).toBeNull()
    // the cups' 330 ml is what one holds: with the count in doubt, the line keeps no package
    expect(receiptPack('Բաժակ թղթե «Էկո Փեյփր» 330մլ, 6հտ', 'AM')).toBeNull()
    expect(receiptPack('Հավկիթ «Ոսկեհավ» 15հտ', 'AM')).toEqual(pieces(15))
  })

  it('reads a Latin «h» beside a size as no pack: a label’s hours (adversarial А1, review №3)', () => {
    expect(receiptPack('Դեզոդորանտ «Rexona» Men Invisible 48h 150մլ', 'AM')).toBeNull()
    expect(receiptPack('Կրեմ դեմքի «Nivea» 24h 50մլ', 'AM')).toBeNull()
    expect(receiptPack('Տոպրակ աղբի 20լ 30h(Հատ)', 'AM')).toBeNull()
    // the Armenian «հտ» beside a size is the pack, as ever (Р-3)
    expect(receiptPack('Աղբի պարկեր «Ֆրեկեն Բոկ» 35լ 30հտ', 'AM')).toEqual(pieces(30))
    // the price, named: alone, hours are a pack — nothing tells them from the model's napkins
    expect(receiptPack('Դեզոդորանտ «Nivea» Men 48h', 'AM')).toEqual(pieces(48))
  })

  it('reads a Latin «H» as an «h»: hours in capitals beside a size are no pack (review 2, №6, В3)', () => {
    expect(receiptPack('Դեզոդորանտ «Rexona» Men Invisible 48H 150մլ', 'AM')).toBeNull()
    expect(receiptPack('Տոպրակ աղբի 20լ 30H', 'AM')).toBeNull()
  })

  it('reads none of a count of pieces with a sign of times before it (review 2, №7)', () => {
    expect(receiptPack('Ձու 2x10հտ', 'AM')).toBeNull()
    expect(receiptPack('Անձեռոցիկ 3 x 100հ', 'AM')).toBeNull()
    expect(receiptPack('Ձու 10հտ x 2', 'AM')).toBeNull()
    // a range before a count is no sign of times: the model's «1.5/4hտ» of a battery is four
    expect(receiptPack('Մարտոց «Էվրոլի» Սուլեր ԱՄ 1.5/4hտ', 'AM')).toEqual(pieces(4))
  })

  it.each([
    ['Թեյ 25հտ x 2գ', 25],
    ['Կոնֆետ 20հտ x 15գ', 20],
    ['Сет Ронин 32шт x 30г', 32],
  ])('multiplies a count only by a bare number after it: %s (review 2, В1)', (printed, count) => {
    expect(receiptPack(printed, 'AM')).toEqual(pieces(count))
  })

  it.each([['Чай 25пакх2г'], ['Թեյ 25փթx2գ'], ['Թեյ 25փաթեթx2գր']])(
    'reads none where a sign of times glued to a word and the figure cuts the count: %s (review 2, В2)',
    (printed) => {
      expect(receiptPack(printed, 'AM')).toBeNull()
    },
  )

  it('reads a year only before the Russian «г»: an Armenian or a Latin gram is a package (review 2, В4)', () => {
    expect(receiptPack('Կեր կատվի «Whiskas» 2000գ', 'AM')).toEqual(kg(2000))
    expect(receiptPack('Լվացքի փոշի «Ariel» 1950գ', 'AM')).toEqual(kg(1950))
    expect(receiptPack('Կերակրի աղ 2000գր', 'AM')).toEqual(kg(2000))
    expect(receiptPack('Գինի «Արենի» 2019г', 'AM')).toBeNull()
  })

  it.each([
    ['ЧАЙ ГРИНФИЛД 25ПАК Х 2Г', 'AM'],
    ['ЧАЙ ГРИНФИЛД 25ПАКХ2Г', 'AM'],
    ['Чай 25пакх 2г', 'AM'],
    ['Ձու 2X10հտ', 'AM'],
    ['Ձու 2 X 10հտ', 'AM'],
    ['CAJ NEVEN 25 KES X 2G', 'RS'],
    ['MIX 2X10KOM', 'RS'],
  ] as const)(
    'reads a sign of times in either case, apart or ending the count’s word: %s (review 3, Г1, Г3)',
    (printed, country) => {
      expect(receiptPack(printed, country)).toBeNull()
    },
  )

  it.each([
    ['Պահպանակ Durex 3հտ', 'AM', pieces(3)],
    ['Անձեռոցիկ Kleenex 100հ', 'AM', pieces(100)],
    ['Батарейки пальчиковых 4шт', 'AM', pieces(4)],
    ['Tide max 20KOM', 'RS', pieces(20)],
    ['Pepsi MAX 1.5լ', 'AM', l(1500)],
  ] as const)(
    'reads the last letter of a word as the word’s own, never a sign of times: %s (review 3, №8, Г5)',
    (printed, country, pack) => {
      expect(receiptPack(printed, country)).toEqual(pack)
    },
  )

  it('takes a unit after the multiplier, glued or apart, as what each piece weighs (review 3, Г2)', () => {
    expect(receiptPack('Сет Ронин 32шт х 30 г', 'AM')).toEqual(pieces(32))
    expect(receiptPack('Կոնֆետ 20հտ x 15 գ', 'AM')).toEqual(pieces(20))
  })

  it.each([
    ['Ձու «Ոսկեհավ» 10հտ x 2 տուփ'],
    ['Яйцо С1 10шт х 3 уп'],
    ['Թուղթ զուգարանի 4հ x 2 Zewa'],
    ['Անձեռոցիկ 100հ x 2 շերտ'],
    ['Անձեռոցիկ 100հ x 2շերտ'],
    ['Бумага туалетная 4шт х 2-х слойная'],
    ['Салфетки «Зева» 100шт х 3-слойные'],
  ])(
    'reads none where a word or a hyphen after the multiplier may be packs or plies: %s (review 4, Д1, Д2, №10)',
    (printed) => {
      expect(receiptPack(printed, 'AM')).toBeNull()
    },
  )

  it.each([
    ['Թուղթ զուգարանի 4հ x 2 «Զևա»'],
    ['Անձեռոցիկ «Զևա» 100հ x 2 (շերտ)'],
    ['Салфетки 100шт х 2 «слоя»'],
    ['Անձեռոցիկ «Զևա» 100հ x 2֊շերտ'],
    ['Салфетки «Зева» 100шт х 3–слойные'],
    ['Бумага туалетная 4шт х 2‑х слойная'],
    ['Թուղթ զուգարանի 4հ x 2, Զևա'],
    ['Яйцо С1 10шт х 3.'],
  ])(
    'reads none of a count whose «× N» no unit of a size follows: %s (review 5, Е1, Е2)',
    (printed) => {
      expect(receiptPack(printed, 'AM')).toBeNull()
    },
  )

  it.each([
    ['Капсулы для стирки Ariel 3в1 Max 25шт'],
    ['Батарейки Duracell LR6 Max 4шт'],
    ['Карандаши 12 цветных 2шт'],
    ['Шампунь Head & Shoulders 2in1 Max 400мл'],
    ['Конфеты в 2 вкусах 200г'],
    // a word ending in «x» after a figure reads as a count's word: these are the price of З1 (review 7)
    ['Чай «Greenfield» 25 пакетикиx 2г'],
    ['ЧАЙ ГРИНФИЛД 25 ПАКЕТИКИХ 2Г'],
    ['Яйцо С1 2 коробкиx 10шт'],
  ])(
    'reads a word ending in «x» after a figure as a sign of times: %s (review 7, З1)',
    (printed) => {
      expect(receiptPack(printed, 'AM')).toBeNull()
    },
  )

  it.each([
    ['Яйцо С1 10шт. х 3', 'AM'],
    ['Թուղթ զուգարանի 4հ. x 2', 'AM'],
    ['Թուղթ զուգարանի 4հ «Զևա» x 2', 'AM'],
    ['Салфетки 100шт белые х 2', 'AM'],
    ['Ձու 10հտ (C1) x 3', 'AM'],
    ['JAJA L 10KOM. X 3 (Ђ)', 'RS'],
  ] as const)(
    'reads none where a sign of times with a figure stands anywhere after a count: %s (review 7, З2)',
    (printed, country) => {
      expect(receiptPack(printed, country)).toBeNull()
    },
  )

  it('keeps a count whose later figure is a size, and one with no sign after it', () => {
    expect(receiptPack('Чай 25шт (Greenfield) x 2г', 'AM')).toEqual(pieces(25))
    expect(receiptPack('Անձեռոցիկ «Զևա» 100հ, սպիտակ', 'AM')).toEqual(pieces(100))
  })

  it.each([
    ['Чай «Greenfield» 25 пакх2г'],
    ['ЧАЙ ГРИНФИЛД 25 ПАКХ2Г'],
    ['Թեյ «Ահմադ» 25 փթx2գ'],
    ['Ձու 2 տուփx10հտ'],
    ['Яйцо 2 упх10шт'],
  ])(
    'reads a sign of times ending the word of a count set apart from it: %s (review 4, Д3)',
    (printed) => {
      expect(receiptPack(printed, 'AM')).toBeNull()
    },
  )

  it('reads a vintage before a capital «Г» too (review 3, №9, Г4)', () => {
    expect(receiptPack('ВИНО АРЕНИ КРАСНОЕ 2019Г', 'RS')).toBeNull()
    expect(receiptPack('Գինի «Արենի» 2019Г', 'AM')).toBeNull()
  })

  it.each([
    ['Чай «Greenfield» 25 пакетикиx2г', 'AM'],
    ['ЧАЙ ГРИНФИЛД 25 ПАКЕТИКИХ2Г', 'AM'],
    ['Пиво 4 банкиx0.5л', 'AM'],
    ['Яйцо С1 2 коробкиx10шт', 'AM'],
    ['Ձու «Ոսկեհավ» 2 տուփիx10հտ', 'AM'],
    ['CAJ NEVEN 20 KESICAX2G (Ђ)', 'RS'],
    ['PIVO 4 LIMENKEX0.5L (Ђ)', 'RS'],
  ] as const)(
    'reads a sign glued to the figure after any letter as a sign: %s (review 6, Ж1, №12)',
    (printed, country) => {
      expect(receiptPack(printed, country)).toBeNull()
    },
  )

  it.each([
    ['MARAMICE ZEWA 100KOM X 2 (Ђ)'],
    ['JAJA L 10KOM X 3 (Ђ)'],
    ['TOALET PAPIR 10/1 X 2 (Ђ)'],
  ])('reads a Serbian count’s «X N» as packs or plies unread: %s (review 6, Ж2)', (printed) => {
    expect(receiptPack(printed, 'RS')).toBeNull()
  })

  it.each([
    ['Салфетки бумажные 100шт 24х24см', 'AM', pieces(100)],
    ['Губки для посуды 5шт 9x6.5см', 'AM', pieces(5)],
    ['Անձեռոցիկ «Զևա» 100հ 33x33սմ', 'AM', pieces(100)],
    ['SALVETE 100KOM 33X33CM (Ђ)', 'RS', pieces(100)],
  ] as const)(
    'reads a sign with a number before it after a count as the thing’s size: %s (review 8, И1, №13)',
    (printed, country, pack) => {
      expect(receiptPack(printed, country)).toEqual(pack)
    },
  )

  it.each([
    ['Пиво «Жигули» 4 банки 0.5л', 'AM'],
    ['Ջուր «Բջնի» 4 շիշ 1.5լ', 'AM'],
    ['Яйцо С1 3 уп по 10шт', 'AM'],
    ['Կաթ «Մարիաննա» 2 տուփ 1լ', 'AM'],
    ['Яйцо С1 3 уп. по 10шт', 'AM'],
    ['Пиво «Жигули» 4банки 0.5л', 'AM'],
    ['Пиво «Жигули» 4 жестяные банки по 0.5л', 'AM'],
    ['Пиво 4 банки «Жигули» 0.5л', 'AM'],
    ['Чай «Greenfield» 25пак 2г', 'AM'],
    ['Ջուր «Բջնի» 4 շիշ, 1.5լ', 'AM'],
    ['PIVO 4 LIMENKE 0,5L (Ђ)', 'RS'],
    ['Йогурт «Danone» 4 стаканчика по 125г', 'AM'],
    ['Яйцо С1 2 лотка по 10шт', 'AM'],
    ['Пиво «Жигули» 4 жестянки 0.5л', 'AM'],
    ['Յոգուրտ «Դանոն» 4 բաժակ 125գ', 'AM'],
    ['Ջուր «Բջնի» 4 շշիկ 0.33լ', 'AM'],
    ['JOGURT 4 CASE 125G (Ђ)', 'RS'],
    ['Пиво «Жигули» упаковка из 4-х банок по 0.5л', 'AM'],
    ['Пиво «Жигули» 4 жестяные пивные банки 0.5л', 'AM'],
    ['Пиво «Жигули» четыре банки 0.5л', 'AM'],
    ['Пиво Heineken 6-pack 0.33л', 'AM'],
    ['PIVO 6-PAK 0.5L (Ђ)', 'RS'],
    ['Йогурт 4 чашки по 125г', 'AM'],
    ['Конфеты 2 кор. 200г', 'AM'],
    ['Яйцо 3 лот. 10шт', 'AM'],
    ['Йогурт 4 стак. 125г', 'AM'],
    ['Մածուն 4 բաժ. 125գ', 'AM'],
    ['Пиво «Жигули» упаковка из шести банок 0.5л', 'AM'],
    ['Вино «Арени» набор из двух бутылок 0.75л', 'AM'],
    ['Пиво «Жигули» полдюжины банок 0.5л', 'AM'],
    ['Пиво «Heineken» six-pack 0.33л', 'AM'],
    ['Ջուր «Բջնի» վեցական շիշ 0.5լ', 'AM'],
    ['Пиво «Жигули» 6 в упаковке 0.5л', 'AM'],
    ['PIVO 6 U PAKOVANJU 0,5L (Ђ)', 'RS'],
    ['Пиво «Жигули» упаковка из 6ти банок 0.5л', 'AM'],
    ['Пиво «Жигули» пара банок 0.5л', 'AM'],
    ['Пиво «Heineken» 6pk 0.33л', 'AM'],
    ['Пиво «Heineken» x6 0.33л', 'AM'],
    ['Пиво «Heineken» sixpack 0.33л', 'AM'],
    ['Пиво мультипак 0.5л', 'AM'],
    ['Пиво тридцать банок 0.33л', 'AM'],
    ['Пиво 1+1 0.5л', 'AM'],
    ['Ջուր 0.5լ/6', 'AM'],
    ['Виски «Johnnie Walker» 12 лет с коробкой 0.7л', 'AM'],
    ['Вода «Бжни» 0.5л 1х12', 'AM'],
    ['Ջուր «Բջնի» 2x6 0.5լ', 'AM'],
    ['VODA ROSA 0,5L 1X12 (Ђ)', 'RS'],
    ['Пиво «Жигули» двойная упаковка 0.5л', 'AM'],
    ['Сок «Добрый» трио 0.2л', 'AM'],
    ['Пиво спарка 0.5л', 'AM'],
    ['Beer «Heineken» double pack 0.33l', 'AM'],
    ['MLEKO DUPLO PAKOVANJE 1L (Ђ)', 'RS'],
    ['Чай Lipton 200 пакетиков 2г', 'AM'],
  ] as const)(
    'reads none where another count stands beside the size, in figures or in a word: %s (reviews 8–12)',
    (printed, country) => {
      expect(receiptPack(printed, country)).toBeNull()
    },
  )

  it.each([
    ['Пиво «Балтика» 7 Экспортное 0.5л', 'AM'],
    ['Կոնյակ «Արարատ» 5 աստղ 0.5լ', 'AM'],
    ['Туалетная бумага Zewa 3 слоя 8шт', 'AM'],
    ['Подгузники Pampers Active Baby 4 Maxi 52шт', 'AM'],
    ['Хлеб «Бородинский» 7 злаков 400г', 'AM'],
    ['Кофе 3 в 1 MacCoffee 18г', 'AM'],
    ['RAKIJA 5 GODINA 0.7L (Ђ)', 'RS'],
    ['Сухарики «3 Корочки» ржаные 40г', 'AM'],
    ['Виски «Johnnie Walker» 12 лет в коробке 0.7л', 'AM'],
    ['Пиво «Балтика» 7 бут. 0.47л', 'AM'],
    ['Конфеты «Три медведя» 200г', 'AM'],
    ['400G NESTAFTER EIGHT KO (Ђ)', 'RS'],
    // the model's copy of «4շ» and «3շ», plies
    ['Անձեռոցիկ 75h 42 649(Հատ)', 'AM'],
    ['Թուղթ զուգարանի Neva 12H 32', 'AM'],
  ] as const)(
    'keeps none where the name prints a number of its own — the price, named as a class (review 12): %s',
    (printed, country) => {
      expect(receiptPack(printed, country)).toBeNull()
    },
  )

  it.each([
    ['Вода 1 бут. 1.5л', 'AM', l(1500)],
    ['VODA PET BOCA 1.5L (Ђ)', 'RS', l(1500)],
    ['Сыр по-русски 300г', 'AM', kg(300)],
    ['Йогурт стаканчик по 125г', 'AM', kg(125)],
    ['Кабачки 1кг', 'AM', kg(1000)],
    ['Կաթ «Իգիթ» 3.2% 1լ', 'AM', l(1000)],
    ['Pampers N4 9-14կգ 52հտ', 'AM', pieces(52)],
    ['Пакеты фасовочные 100шт 24х37', 'AM', pieces(100)],
    ['Чипсы «Чипселла 3D» 100г', 'AM', kg(100)],
    ['Կոնյակ «Նոյ» ընծայական 5տ (տուփով) 0.5լ', 'AM', l(500)],
    ['Թուղթ զուգարանի Neva 12հ 3շ', 'AM', pieces(12)],
    ['17.Պաղպաղակ «Թամարա» 80գր', 'AM', kg(80)],
    ['SOK 0,2L (Ђ) 9639', 'RS', l(200)],
    ['Кофе MacCoffee 3в1 20х18г', 'AM', kg(360)],
    ['Шампунь Head & Shoulders 2in1 400мл', 'AM', l(400)],
    ['Вино «Арени» 2019 0.75л', 'AM', l(750)],
    ['Йогурт 125г №4', 'AM', kg(125)],
    ['Водка «Арарат» 40° 0.5л', 'AM', l(500)],
    ['Коньяк «Ной» 40 ° 0.5л', 'AM', l(500)],
    ['Вода «Бжни» 0.5л x12', 'AM', l(6000)],
    ['Փայտիկ ականջի 250h 193', 'AM', pieces(250)],
  ] as const)(
    'reads the size where no other count stands — a 1, a fraction, a percent, a range, a width, a model’s or a line’s number, a code (review 12): %s',
    (printed, country, pack) => {
      expect(receiptPack(printed, country)).toEqual(pack)
    },
  )

  it.each([['Ձու «Ոսկեհավ» 10հտ C1 x 3'], ['Яйцо 10шт С0 х 2'], ['Батарейки 4шт AA LR6 x 2']])(
    'reads a sign after a figure glued to a letter as packs unread: %s (review 9, Й3)',
    (printed) => {
      expect(receiptPack(printed, 'AM')).toBeNull()
    },
  )

  it('keeps a size after a unit glued to its number or a hyphen: words of the name', () => {
    expect(receiptPack('Սուրճ լուծվող «Մակ Կոֆե» թունդ 3-ը 1-ում 18գր', 'AM')).toEqual(kg(18))
    expect(receiptPack('Մարտկոց «Էներջի» Սուպեր ԱԱ 1.5Վ 4հտ', 'AM')).toEqual(pieces(4))
  })

  it('reads none of a thousandth of a gram', () => {
    expect(receiptPack('Դեղ 0.5գր', 'AM')).toBeNull()
  })
})

describe('receiptPack — a Serbian journal', () => {
  it.each([
    ['Elixir mix 0.33l (Ђ)', l(330)],
    ['0.5L AQUA VIVA VODA  FL (Ђ)', l(500)],
    ['Det.za sud.Mer aloe vera 750ml/KOM (Ђ)', l(750)],
    ['JОГУРТ 2.8% 0.18Л МИЛК ХОУСЕ (Е)', l(180)],
    ['MLEKO 1 L KOM (Е)', l(1000)],
    // no photo, no doubt of a 6
    ['Mineralna voda NG Maxi 6l/KOM (Ђ)', l(6000)],
  ])('reads a size: %s', (printed, pack) => {
    expect(receiptPack(printed, 'RS')).toEqual(pack)
  })

  it.each([
    ['CLEANIC BLAZ. 107KOM (Ђ)', pieces(107)],
    ['5KOM FINO KUHINJSKI  KO (Ђ)', pieces(5)],
    ['10/1 VIGO ZIPER KESA KO (Ђ)', pieces(10)],
    ['[528195] KASIKA PLASTICNA BELA FRESH 20/ 1  [KOM] (Ђ)', pieces(20)],
  ])('reads a pack of pieces: %s', (printed, pack) => {
    expect(receiptPack(printed, 'RS')).toEqual(pack)
  })

  it.each([
    ['KNJAZ MILOS 0.25(KOM) (Ђ)'],
    // a fraction, «1/1» as «1/2»: the denominator is no size (adversarial А3)
    ['MLEKO 2,8% 1/2L (Ђ)'],
    ['MLEKO 2,8% 1/1L (Ђ)'],
    ['CEDJENA NARANDZA 0.2/kom (Ђ)'],
    ['KESA VJZ 7KG 51 MIKRON           KOM (Ђ)'],
    // «KOM» apart is the journal's unit of sale, never a pack
    ['0252491 TRAKA ZA PROZORE I VRATA "D"-BRA ON 9MM X 6 KOM (Ђ)'],
    ['Grcki omlet (Ђ)'],
  ])('reads none: %s', (printed) => {
    expect(receiptPack(printed, 'RS')).toBeNull()
  })

  it('reads an Armenian word as nothing of Serbia, and «հտ» as no Serbian pack', () => {
    expect(receiptPack('Հավկիթ 10հտ', 'RS')).toBeNull()
  })
})

describe('linePack', () => {
  const printed = 'Կաթ «Իգիթ» 3.2% 1լ'

  it('is the package of a line the till sold in pieces', () => {
    expect(linePack({ printed, quantity: pieces(2) }, 'AM')).toEqual(l(1000))
  })

  it('is none of a line weighed, poured or emptied by the check', () => {
    expect(linePack({ printed, quantity: kg(434) }, 'AM')).toBeNull()
    expect(linePack({ printed, quantity: l(1000) }, 'RS')).toBeNull()
    expect(linePack({ printed, quantity: null }, 'AM')).toBeNull()
  })
})

describe('packedQuantity', () => {
  it('is the till’s pieces times the package', () => {
    expect(packedQuantity(pieces(1), l(1500))).toEqual(l(1500))
    expect(packedQuantity(pieces(2), l(1000))).toEqual(l(2000))
    expect(packedQuantity(pieces(2), kg(250))).toEqual(kg(500))
    expect(packedQuantity(pieces(1), pieces(10))).toEqual(pieces(10))
    expect(packedQuantity(pieces(3), pieces(10))).toEqual(pieces(30))
  })

  it('leaves a line the till weighed, a line with no package and a line with no count', () => {
    expect(packedQuantity(kg(434), l(1000))).toEqual(kg(434))
    expect(packedQuantity(pieces(1), null)).toEqual(pieces(1))
    expect(packedQuantity(null, l(1000))).toBeNull()
  })

  it('leaves the till’s count where the product would not fit a column', () => {
    const many: Quantity = { milli: 9_000_000_000_000_000_000n, unit: 'piece' }
    expect(packedQuantity(many, kg(50_000))).toEqual(many)
  })
})
