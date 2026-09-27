import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newItemSchema } from '@molvia/model'
import { connectDrizzle } from './db'
import { clearAll } from './fixtures'
import { CATALOGUE_SEED } from '@/catalogue-seed'
import { createItemRepository } from '@/db/items-repository'
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
    // The right item first, and far: «собачий» is four edits from «собак». Another form than the
    // label's, the class MOL-46 draws as «Похоже по написанию».
    ['собачий корм', 'Корм для собак', false],
    ['корм собакам', 'Корм для собак', false],
  ] as const)('«%s» → %s', async (query, name, near) => {
    expect(await first(query)).toEqual([name, near])
  })

  /**
   * A brand is not seeded and not a synonym (MOL-112): expanded into its kind, it would tie with
   * the brand's own item once someone proposes it, and the shorter generic name would stand above
   * it on its own query (В-5). What reaches the kind is the person's own word (MOL-45): a miss,
   * then a pick, is learnt. A brand over a kind is a miss as well, and the screen offers
   * «Предложить товар» (owner's decision В-1).
   */
  it.each([
    'фанта',
    'дошик',
    'несквик',
    'нутелла',
    'принглс',
    'читос',
    'молоко марианна',
    'кефир ашхар',
  ])("«%s» is not near: the brand is the person's to propose", async (query) => {
    expect((await first(query))[1]).toBe(false)
  })
})
