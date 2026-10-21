import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { newItemSchema } from '@molvia/model'
import type { ReceiptLine } from '@molvia/model'
import { CATALOGUE_SEED } from '@/catalogue-seed'
import { CATALOGUE_SEED_NODES } from '@/catalogue-seed-nodes'
import { createItemRepository } from '@/db/items-repository'
import { items } from '@/db/schema'
import { createSeedRepository } from '@/db/seed-repository'
import { NO_EMBEDDER } from '@/embeddings/embedder'
import { bindReceiptLines } from '@/usecases/bind-receipt-lines'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem } from './fixtures'

/**
 * The lines of an Armenian receipt against the whole seed with its till names and headings — the catalogue of
 * production since 21.10.2026 — through the product's own binding and search (MOL-293). The lines are the seed's
 * own names: what the catalogue itself says a till prints for its item (adversarial review, round 1).
 */
const { db, close } = connectDrizzle()
const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'

// The seed is written once for the file: some 7 s on a Mac, so the hook takes 120 s (MOL-243).
beforeAll(async () => {
  await clearAll(db)
  const lines = CATALOGUE_SEED.map(([name, unit]) =>
    newItemSchema.parse({ kind: 'product', name, defaultUnit: unit }),
  )
  await createSeedRepository(db).seed(lines, { dryRun: false, nodes: CATALOGUE_SEED_NODES })
}, 120_000)
afterAll(async () => {
  await clearAll(db)
  await close()
})

const line = (printed: string, hs: string | null = null): ReceiptLine => ({
  printed,
  hs,
  sku: null,
  quantity: null,
  price: null,
  sum: null,
  discount: null,
  settled: false,
})

async function bind(printed: string, hs: string | null = null) {
  const [bound] = await bindReceiptLines(
    { items: createItemRepository(db), embedder: NO_EMBEDDER },
    ACTOR,
    'AM',
    'ru',
    [line(printed, hs)],
  )
  if (!bound) throw new Error('no binding')
  const [row] =
    bound.itemId === null
      ? []
      : await db.select({ name: items.name }).from(items).where(eq(items.id, bound.itemId))
  return { ...bound, name: row?.name ?? null }
}

describe('a line by the seed’s own till name (MOL-293, adversarial А1)', () => {
  it.each([
    ['Ատամի պաստա', 'Паста зубная'],
    ['Չերի', 'Помидоры черри'],
    ['Սիռոկ', 'Сырок творожный'],
    ['Բատոնչիկ', 'Батончик шоколадный'],
    ['Աղ սպասքալվացող մեքենայի', 'Соль для посудомойки'],
    ['Կաթ նուշի', 'Молоко миндальное'],
    ['Գարեջուր ոչ ալկոհոլային', 'Пиво безалкогольное'],
    ['Ծիրան չորացրած', 'Курага'],
    ['Կոկոսի ընկույզ', 'Кокос'],
  ])('binds «%s» to its own «%s»', async (printed, own) => {
    expect(await bind(printed)).toMatchObject({ name: own, match: 'search' })
  })
})

describe('a line by the search, an item of another thing never (MOL-293, adversarial А3–А5, А7)', () => {
  it('takes no biscuit for a liver printed with no heading', async () => {
    const liver = await bind('Լյարդ')
    expect(liver.name).not.toBe('Печенье')
    expect(liver.name === null || liver.name.startsWith('Печень')).toBe(true)
  })

  it('takes no raw meat for a shashlik', async () => {
    for (const printed of ['Խորոված խոզի', 'Խորոված հավի']) {
      const shashlik = await bind(printed)
      expect(['Свинина', 'Курица']).not.toContain(shashlik.name)
    }
  })

  it('takes no 1 % kefir for a 2,5 % one of a litre', async () => {
    await insertItem(db, {
      name: 'Кефир «Марианна» 1%',
      searchKey: 'kefir marianna 1%',
      createdBy: await insertActor(db),
    })
    expect((await bind('Կեֆիր «Մարիաննա» 2.5% 1լ')).name).not.toBe('Кефир «Марианна» 1%')
  }, 10_000)

  it('names no new item by a word the gloss read one edit off', async () => {
    const roller = await bind('Ռոլիկ.')
    expect([roller.itemId, roller.translation]).toEqual([null, null])
  })
})

// two things side by side, a genitive, a word that only starts as the kind, a letter lost (adversarial, round 2)
const FLAVOUR_FIRST: readonly (readonly [string, string])[] = [
  ['Ելակ յոգուրտ', 'Клубника'],
  ['Շոկոլադ պաղպաղակ', 'Шоколад'],
  ['Բալ մուրաբա', 'Вишня'],
]
const UNKNOWN_KIND: readonly (readonly [string, string])[] = [
  ['Ելակ սմուզի', 'Клубника'],
  ['Ելակ սորբետ', 'Клубника'],
  ['Ելակ Smoothie', 'Клубника'],
  ['Խնձոր շտրուդել', 'Яблоки'],
  ['Խնձոր պաստեղ', 'Яблоки'],
  ['Շոկոլադ կեքսիկ', 'Шоколад'],
]
const ONLY_A_START: readonly (readonly [string, string])[] = [
  ['Տուշ թարթիչների', 'Тушёнка'],
  ['Թել կարի', 'Вермишель'],
  ['Հավի վերևի մաս', 'Маслины'],
  ['Դեղ գլխացավի', 'Персики'],
]
const LETTER_LOST: readonly (readonly [string, string])[] = [
  ['Սուս չիլի', 'Соус острый'],
  ['Կոլասա եփած', 'Колбаса варёная'],
  ['Սալոաչիր', 'Чернослив'],
  ['Մակա', 'Манка'],
]

describe('a line whose words do not settle its kind, or lost a letter (MOL-293, adversarial Б1–Б4)', () => {
  it.each(FLAVOUR_FIRST)(
    'takes no flavour for the kind of «%s», two things side by side',
    async (printed, flavour) => {
      expect((await bind(printed)).name).not.toBe(flavour)
    },
  )

  it.each(UNKNOWN_KIND)(
    'takes no flavour for «%s», a kind the dictionary has not or glossed with its quality (adversarial В1, В2)',
    async (printed, flavour) => {
      expect((await bind(printed)).name).not.toBe(flavour)
    },
  )

  it('takes no thing of a genitive in «-ու» or «-ան» for the kind (review 2, №2)', async () => {
    expect(await bind('Ազնվամորու մուրաբա')).toMatchObject({ name: 'Варенье', match: 'search' })
    expect(await bind('Գինու քացախ')).toMatchObject({ name: 'Уксус', match: 'search' })
    expect((await bind('Ձկան սոուս')).name).not.toBe('Рыба')
  })

  it.each(ONLY_A_START)(
    'takes for «%s» no «%s», whose word only starts as the kind does',
    async (printed, other) => {
      expect((await bind(printed)).name).not.toBe(other)
    },
  )

  it.each(LETTER_LOST)('finds for «%s», a letter lost, its own «%s»', async (printed, own) => {
    expect(await bind(printed)).toMatchObject({ name: own, match: 'search' })
  })

  it('takes a sort printed bare for no kind, and a standard in Latin for no thing (adversarial Г2, Г3)', async () => {
    expect(await bind('Լեզու տավարի Արցախ')).toMatchObject({
      name: 'Язык говяжий',
      match: 'search',
    })
    expect(await bind('Կաթ UHT 3.2%')).toMatchObject({ name: 'Молоко 3,2%', match: 'search' })
    expect((await bind('Մարտկոց AA')).name).toBe('Батарейки')
  })

  it('finds nothing for a letter misread: a roller is no tomato', async () => {
    expect((await bind('Ռոլիկ')).itemId).toBeNull()
  })
})
