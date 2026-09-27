import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { newItemSchema, toSearchKey } from '@molvia/model'
import { connectDrizzle } from './db'
import { clearAll, insertItem } from './fixtures'
import { CATALOGUE_SEED } from '@/catalogue-seed'
import { createItemRepository } from '@/db/items-repository'
import { items } from '@/db/schema'
import { createSeedRepository } from '@/db/seed-repository'

/**
 * The owner's own words from a month of the expense log (25.08–25.09.2026, MOL-112), through the
 * search, against the seed alone. The list grows by commits, and a line added there can take the
 * first row of a word that was fine yesterday: this is where that shows. Things («кружка»,
 * «зонт») and names of a shelf («овощи», «специи») are left out of the seed on purpose, and so
 * out of here.
 */
const { db, close } = connectDrizzle()
const repo = createItemRepository(db)
const nobody = randomUUID()

beforeAll(async () => {
  await clearAll(db)
  const lines = CATALOGUE_SEED.map(([name, unit]) =>
    newItemSchema.parse({ kind: 'product', name, defaultUnit: unit }),
  )
  await createSeedRepository(db).seed(lines, { dryRun: false })
}, 60_000)

afterAll(async () => {
  await clearAll(db)
  await close()
})

async function first(query: string): Promise<[string | undefined, boolean]> {
  const { items, near } = await repo.search(query, 20, nobody)
  return [items[0]?.name, near]
}

describe("the owner's words, against the seed", () => {
  /** The word, the name the person sees first, and whether the answer is near (MOL-46). */
  it.each([
    ['кола', 'Кола', true],
    ['молоко', 'Молоко', true],
    ['салфетки', 'Салфетки', true],
    ['колбаса', 'Колбаса', true],
    // The length decides between the feeds: `sobak` is a letter shorter than `koshek`. A feed with
    // a shorter name added to the list would take this row without a word (review С-6).
    ['корм', 'Корм для собак', true],
    ['сок', 'Сок', true],
    ['туалетная бумага', 'Бумага туалетная', true],
    ['туалетка', 'Бумага туалетная', true],
    ['булочки', 'Булочки', true],
    ['булки', 'Булочки', true],
    ['стиральный порошок', 'Порошок стиральный', true],
    ['порошок', 'Порошок стиральный', true],
    ['чипсы', 'Чипсы', true],
    ['вода', 'Вода', true],
    ['говядина', 'Говядина', true],
    ['картошка', 'Картофель', true],
    ['кетчуп', 'Кетчуп', true],
    ['котлеты', 'Котлеты', true],
    ['креветки', 'Креветки', true],
    ['курица', 'Курица', true],
    ['оливки', 'Оливки', true],
    ['отбеливатель', 'Отбеливатель', true],
    ['белизна', 'Отбеливатель', true],
    ['спагетти', 'Спагетти', true],
    ['хлеб', 'Хлеб', true],
    ['батарейки', 'Батарейки', true],
    ['бритва', 'Бритва', true],
    ['виноград', 'Виноград', true],
    ['гель для бровей', 'Гель для бровей', true],
    ['греча', 'Гречка', true],
    ['инжир', 'Инжир', true],
    ['клубника', 'Клубника', true],
    ['кофе', 'Кофе', true],
    ['крекеры', 'Крекеры', true],
    ['кукуруза', 'Кукуруза', true],
    ['лапша', 'Лапша', true],
    ['манго', 'Манго', true],
    ['маслины', 'Маслины', true],
    ['мидии', 'Мидии', true],
    ['мука', 'Мука', true],
    ['мусорные пакеты', 'Пакеты мусорные', true],
    ['наполнитель', 'Наполнитель для лотка', true],
    ['нектарины', 'Нектарины', true],
    ['огурцы', 'Огурцы', true],
    ['орешки', 'Орехи', true],
    ['паштет', 'Паштет', true],
    ['персики', 'Персики', true],
    ['перчатки', 'Перчатки резиновые', true],
    ['пиво', 'Пиво', true],
    ['пирожные', 'Пирожные', true],
    ['полотенца', 'Полотенца бумажные', true],
    ['помидоры', 'Помидоры', true],
    ['прищепки', 'Прищепки', true],
    ['рис', 'Рис', true],
    ['рыба', 'Рыба', true],
    ['сливки', 'Сливки', true],
    ['соевый соус', 'Соус соевый', true],
    ['средство для полов', 'Средство для мытья полов', true],
    ['сыр', 'Сыр', true],
    ['таблетки для посудомойки', 'Таблетки для посудомойки', true],
    ['творог', 'Творог', true],
    ['тесто для пиццы', 'Тесто для пиццы', true],
    ['хлопья', 'Хлопья', true],
    // The herb, not the lemonade: `tarhun` is shorter than `limonad tarhun`, though in Armenia the
    // word names the drink as often (review С-6). Pinned as it is.
    ['тархун', 'Тархун', true],
    // A size in the query: the common name first, not the variety whose fat or grade shares a
    // digit or a letter with it (adversarial А, Б) — the length ranks before the similarity.
    ['молоко 1 л', 'Молоко', true],
    ['молоко 2 л', 'Молоко', true],
    ['молоко 0,5 л', 'Молоко', true],
    ['кефир 1 л', 'Кефир', true],
    ['рис 1 кг', 'Рис', true],
    ['сахар 1 кг', 'Сахар', true],
    ['мука 2 кг', 'Мука', true],
    ['малако', 'Молоко', false],
    // A whole word above the exact start of a longer one (MOL-10, review И).
    ['маска', 'Маска для лица', true],
    // The fat typed with «%» names the variety, whatever the size beside it (review З).
    ['кефир 2,5% 1 л', 'Кефир 2,5%', true],
    ['молоко 3,2% 1 л', 'Молоко 3,2%', true],
    ['сметана 20% 400 г', 'Сметана 20%', true],
    // A fat the list lacks is the common name, not the variety sharing a digit (review Н).
    ['молоко 3,5%', 'Молоко', true],
    ['молоко 3,5% 1 л', 'Молоко', true],
    ['кефир 1,5%', 'Кефир', true],
    ['творог 0,5%', 'Творог', true],
    // Nor is a whole fat paired by the digit it shares with another (review Н′).
    ['молоко 1%', 'Молоко', true],
    ['молоко 5%', 'Молоко', true],
    ['кефир 2%', 'Кефир', true],
    // Without «%» both digits of «72,5» and «3,2» pair with the name's exactly, at no cost: the
    // variety first by the distance, before any rule of fats (review С-11). Pinned as it is.
    ['масло 72,5', 'Масло сливочное 72,5%', true],
    ['молоко 3,2', 'Молоко 3,2%', true],
    // Without «%» both «5» of «5,5» pair with the one «5» of «Творог 5%»; with it the digits of the
    // fat are out of the distance, and a fat the list lacks is the common name (review Р).
    ['творог 5,5', 'Творог 5%', true],
    ['творог 5,5%', 'Творог', true],
    // Brands the owner names a kind by lead to the kind through the dictionary (MOL-112, В-6) —
    // to the word of the kind, and among the kinds the shortest: «Лапша» by the kilo, not the
    // instant noodles the word means, and «Какао», not the instant one (review Л), until one pick.
    ['фанта', 'Лимонад', true],
    ['дошик', 'Лапша', true],
    ['несквик', 'Какао', true],
    ['нутелла', 'Паста шоколадная', true],
    ['принглс', 'Чипсы', true],
    // Among the kinds a wide word leads to, the shortest name — the price of the length, named.
    ['мясо', 'Фарш', true],
    // The right item first, and far: «собачий» is four edits from «собак». Another form than the
    // label's, the class MOL-46 draws as «Похоже по написанию».
    ['собачий корм', 'Корм для собак', false],
    ['корм собакам', 'Корм для собак', false],
  ] as const)('«%s» → %s', async (query, name, near) => {
    expect(await first(query)).toEqual([name, near])
  })

  // «Печень куриная» and «Печень говяжья» are keys of one length, so the uuid picks between them;
  // what is held is that a liver comes first and not «Печенье» (review И).
  it('«печень» → a liver, not «Печенье»', async () => {
    expect((await first('печень'))[0]).toMatch(/^Печень /u)
  })

  /**
   * A brand over a kind is a miss, and the screen offers «Предложить товар» (owner's decision
   * В-1); «читос» has no kind of its own in the dictionary and waits for the person's own word.
   */
  it.each(['читос', 'молоко марианна', 'кефир ашхар'])('«%s» is not near', async (query) => {
    expect((await first(query))[1]).toBe(false)
  })

  /**
   * The brand's own item, once proposed, stands above the kind its word leads to: both are found
   * at no cost, the brand by the word typed and the kind by a synonym, and at one distance the
   * typed word ranks first (\`by_synonym\`) — not the similarity, which ranks after the length
   * (review С-8, М). MOL-112 first kept brands out of the dictionary on a claim about this that
   * was wrong (adversarial Д).
   */
  it.each([
    ['фанта', 'Фанта 0,5 л'],
    ['дошик', 'Дошик курица'],
    ['принглс', 'Принглс оригинал'],
  ])('«%s» puts a proposed «%s» above the kind', async (query, name) => {
    const id = await insertItem(db, { name, searchKey: toSearchKey(name), defaultUnit: 'piece' })
    try {
      expect((await first(query))[0]).toBe(name)
    } finally {
      await db.delete(items).where(eq(items.id, id))
    }
  })
})
