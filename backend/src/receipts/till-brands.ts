/**
 * Brands and product lines as an Armenian till prints them, to how their package spells them (MOL-261, owner's
 * В-2 «а»): a new item's name writes a Latin brand as the shelf does, with no quotes — «Печенье Roshen Lovita
 * клубника 135 г» — and a Cyrillic one in «…»; a brand not here is spelt in Russian letters, as before. A line
 * may name an item by either spelling: «Կինդեր» is Kinder.
 *
 * Keyed in lower case, «և» as one letter, words one space apart. Filled from the brands of the bench's receipts
 * (MOL-114) whose letters do not give the shelf's name, and from the owner's own items; a brand is added here,
 * never in code.
 */
export const TILL_BRANDS: Readonly<Record<string, string>> = {
  // Latin on the package
  'կոկա կոլա': 'Coca-Cola',
  ֆանտա: 'Fanta',
  միլկա: 'Milka',
  ռոշեն: 'Roshen',
  կինդեր: 'Kinder',
  պրինգլս: 'Pringles',
  սնիկերս: 'Snickers',
  'մակ կոֆե': 'MacCoffee',
  օրբիտ: 'Orbit',
  բարիլլա: 'Barilla',
  բելվիտա: 'Belvita',
  գորիլլա: 'Gorilla',
  'գրանդ քենդի': 'Grand Candy',
  գրինֆիլդ: 'Greenfield',
  կիտկատ: 'KitKat',
  'կիտ կատ': 'KitKat',
  'ֆլեշ ափ': 'Flash Up',
  'ֆրեշ բար': 'Fresh Bar',
  ջափման: 'Chapman',
  բոնֆեստո: 'Bonfesto',
  ցագերմեյստեր: 'Jägermeister',
  'ալպեն գոլդ': 'Alpen Gold',
  // a cat litter's, never the bean curd of a line whose kind it is: «Տոֆու 200գ» stays тофу (MOL-326)
  տոֆու: 'Tofu',
  // the lines of a brand, printed after it
  լովիտա: 'Lovita',
  'արտ բեյքրի': 'Art Bakery',
  բուենո: 'Bueno',
  տրոնկի: 'Tronky',
  դելիս: 'Délice',
  ռեֆրեշերս: 'Refreshers',
  չոկո: 'Choco',
  ջաֆֆա: 'Jaffa',
  ուլտիմատ: 'Ultimate',
  // Cyrillic on the package, where the letters miss it
  ալյոնկա: 'Алёнка',
  կոմունարկա: 'Коммунарка',
  'հոմ մեյդ': 'Хоум Мейд',
  'կռուտոյ օկեռ': 'Крутой Окей',
  'ռայսկի սադ': 'Райский сад',
  ճահուկյան: 'Чаукян',
  միստրալ: 'Мистраль',
  ֆենդել: 'Фендель',
  ոսկեհատ: 'Воскеат',
  'էկո փեյփր': 'Эко Пейпер',
  'սպիտակ գլխարկ': 'Белая шляпка',
  'բերի արտ': 'Берри Арт',
  սլոդիչ: 'Слодыч',
  'չիպսելլա 3դ': 'Чипселла 3D',
  'հոթ փոթ': 'Хот Пот',
  '3 կոռոչկի': '3 корочки',
}
