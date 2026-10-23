import { describe, expect, it } from 'vitest'
import { packedQuantity, receiptPack } from '#model/entities/receipt-pack'
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
    ['Բաժակ թղթե «Էկո Փեյփր» 330մլ, 6հտ', pieces(6)],
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
