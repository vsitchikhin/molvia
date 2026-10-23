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
    ['Անձեռոցիկ 75h 42 649(Հատ)', pieces(75)],
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

  it('multiplies a pack of pieces as it does a size: «4հ x 2» is eight rolls (adversarial А5)', () => {
    expect(receiptPack('Թուղթ զուգարանի «Զևա» 4հ x 2', 'AM')).toEqual(pieces(8))
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
    expect(receiptPack('Թուղթ զուգարանի Neva 12H 32', 'AM')).toEqual(pieces(12))
  })

  it('reads none of a count of pieces with a sign of times before it (review 2, №7)', () => {
    expect(receiptPack('Ձու 2x10հտ', 'AM')).toBeNull()
    expect(receiptPack('Անձեռոցիկ 3 x 100հ', 'AM')).toBeNull()
    expect(receiptPack('Ձու 10հտ x 2', 'AM')).toEqual(pieces(20))
    // a range before a count is no sign of times: the model's «1.5/4hտ» of a battery is four
    expect(receiptPack('Մարտոց «Էվրոլի» Սուլեր ԱՄ 1.5/4hտ', 'AM')).toEqual(pieces(4))
  })

  it.each([
    ['Թեյ 25հտ x 2գ', 25],
    ['Կոնֆետ 20հտ x 15գ', 20],
    ['Сет Ронин 32шт x 30г', 32],
    ['Անձեռոցիկ 100հ x 2շերտ', 100],
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

  it('reads none of a thousandth of a gram', () => {
    expect(receiptPack('Դեղ 0.5գր', 'AM')).toBeNull()
  })
})

describe('receiptPack — a Serbian journal', () => {
  it.each([
    ['Elixir mix 0.33l (Ђ)', l(330)],
    ['0.5L AQUA VIVA VODA  FL (Ђ)', l(500)],
    ['400G NESTAFTER EIGHT KO (Ђ)', kg(400)],
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
