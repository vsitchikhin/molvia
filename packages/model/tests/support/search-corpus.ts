/**
 * The search corpora of MOL-5: twenty-four names, the ways a person spells them, and sixteen
 * names in three scripts. One list read twice — by the key's corpus test here, which runs
 * without a database and guards the alphabet, and by the backend's integration test, which
 * runs the same queries through the real search (MOL-13). Two copies drift silently, and
 * these already did once: `jajca` left one of them in MOL-11.
 *
 * Test data, not domain: it lives under `tests/` and reaches the backend through the
 * `./testing/search-corpus` export only — from tests, never from `src`, which the shared
 * lint preset refuses (`TEST_DATA`).
 */

export const ITEMS = [
  'Молоко Ашхар 3.2%',
  'Молоко Марианна',
  'Сыр Чанах',
  'Сыр Лори',
  'Творог',
  'Кефир',
  'Мацун',
  'Шоколад Гранд Кенди',
  'Лаваш',
  'Яйца',
  'Гречка',
  'Жигули',
  'Хумус',
  'Цукаты',
  'Йогурт',
  'Щербет',
  'Айран',
  'Джем абрикосовый',
  'Масло сливочное',
  'Чай зелёный',
  'Сахар',
  'Форель',
  'Цыплёнок',
  'Икра кабачковая',
] as const

/** What a person actually types: both halves of every fork, and typos on top of them. */
export const QUERIES: readonly (readonly [string, (typeof ITEMS)[number]])[] = [
  ['moloko', 'Молоко Ашхар 3.2%'],
  ['малако', 'Молоко Ашхар 3.2%'],
  ['malako', 'Молоко Ашхар 3.2%'],
  ['ashhar', 'Молоко Ашхар 3.2%'],
  ['ashkhar', 'Молоко Ашхар 3.2%'],
  ['chanah', 'Сыр Чанах'],
  ['chanakh', 'Сыр Чанах'],
  ['canah', 'Сыр Чанах'],
  ['чанах', 'Сыр Чанах'],
  ['tvorog', 'Творог'],
  ['kefir', 'Кефир'],
  ['matsun', 'Мацун'],
  ['macun', 'Мацун'],
  ['shokolad', 'Шоколад Гранд Кенди'],
  ['сокоlad', 'Шоколад Гранд Кенди'],
  ['chokolad', 'Шоколад Гранд Кенди'],
  ['lavash', 'Лаваш'],
  ['yaytsa', 'Яйца'],
  ['yaica', 'Яйца'],
  ['grechka', 'Гречка'],
  ['grecka', 'Гречка'],
  ['jiguli', 'Жигули'],
  ['zhiguli', 'Жигули'],
  ['humus', 'Хумус'],
  ['khumus', 'Хумус'],
  ['tsukaty', 'Цукаты'],
  ['cukati', 'Цукаты'],
  ['yogurt', 'Йогурт'],
  ['iogurt', 'Йогурт'],
  ['shcherbet', 'Щербет'],
  ['sherbet', 'Щербет'],
  ['scherbet', 'Щербет'],
  ['ayran', 'Айран'],
  ['airan', 'Айран'],
  ['djem', 'Джем абрикосовый'],
  ['jem', 'Джем абрикосовый'],
  ['maslo', 'Масло сливочное'],
  ['chai', 'Чай зелёный'],
  ['chay', 'Чай зелёный'],
  ['sahar', 'Сахар'],
  ['sakhar', 'Сахар'],
  ['forel', 'Форель'],
  ['ciplenok', 'Цыплёнок'],
  ['tsyplenok', 'Цыплёнок'],
  ['ikra', 'Икра кабачковая'],
]

/** Armenian on the shelf, Russian in the head, Latin on the keyboard. */
export const TRIPLES: readonly (readonly [string, string, string])[] = [
  ['Ջերմուկ', 'Джермук', 'Jermuk'],
  ['Չանախ', 'Чанах', 'Chanakh'],
  ['Գյումրի', 'Гюмри', 'Gyumri'],
  ['Երևան', 'Ереван', 'Yerevan'],
  ['Մածուն', 'Мацун', 'Matsun'],
  ['Լավաշ', 'Лаваш', 'Lavash'],
  ['Ղափամա', 'Гапама', 'Ghapama'],
  ['Թան', 'Тан', 'Tan'],
  ['Բասթուրմա', 'Бастурма', 'Basturma'],
  ['Քունջութ', 'Кунжут', 'Kunjut'],
  ['Աշխար', 'Ашхар', 'Ashkhar'],
  ['Նոյ', 'Ной', 'Noy'],
  ['Ծաղկունք', 'Цахкунк', 'Tsaghkunk'],
  ['Հաց', 'Ац', 'Hats'],
  ['Սուջուխ', 'Суджух', 'Sujukh'],
  ['Փախինդզ', 'Пахиндз', 'Pakhindz'],
]
