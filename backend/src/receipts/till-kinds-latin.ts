/**
 * The kinds of goods a till prints in Latin letters (MOL-126, round 10): «GYUMRI LAGER», «YEREVAN BRANDY».
 * Beside a city they make a receipt's row an item's, not its address. Not the gloss's: the gloss reads
 * Armenian words only, and its dictionary is `till-words-ru.ts` as the bench made it (Р-7).
 */
export const TILL_KINDS_LATIN: readonly string[] = [
  'beer',
  'lager',
  'ale',
  'brandy',
  'cognac',
  'vodka',
  'wine',
  'water',
  'juice',
  'milk',
  'cheese',
  'bread',
  'coffee',
  'tea',
  'chips',
  'chocolate',
  'yogurt',
  'sausage',
  'soda',
  'lemonade',
]
