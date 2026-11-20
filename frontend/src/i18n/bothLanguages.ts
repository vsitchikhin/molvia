import type { AppLocale, SpendingPreset } from '@molvia/model'

/**
 * Words the app reads back from data in every language it speaks, whatever this device speaks (MOL-337): a
 * dictionary is a chunk of its own and a device holds one, so a reader of the other language's words would
 * pull its whole dictionary in — `accounts.ts` did, on every screen of money, at every launch. These few stand
 * apart, held equal to both dictionaries by `bothLanguages.test.ts`; none is shown — a screen says its words
 * through `t`.
 */
export const BOTH_LANGUAGES = {
  ru: {
    /** The note «Записать разницу» writes (`accounts.reconcile.note`). */
    reconcileNote: 'сверка',
    /** The ready-made categories' names (`spending.category.*`). */
    presets: {
      groceries: 'Продукты',
      cafe: 'Кафе и рестораны',
      rent: 'Аренда жилья',
      home: 'Дом и быт',
      beauty: 'Красота и гигиена',
      transport: 'Транспорт',
      telecom: 'Связь и интернет',
      health: 'Здоровье',
      clothes: 'Одежда',
      pets: 'Животные',
      leisure: 'Развлечения',
      documents: 'Документы',
      other: 'Прочее',
    },
  },
  en: {
    reconcileNote: 'check',
    presets: {
      groceries: 'Groceries',
      cafe: 'Cafés and restaurants',
      rent: 'Rent',
      home: 'Home',
      beauty: 'Beauty and hygiene',
      transport: 'Transport',
      telecom: 'Phone and internet',
      health: 'Health',
      clothes: 'Clothes',
      pets: 'Pets',
      leisure: 'Leisure',
      documents: 'Documents',
      other: 'Other',
    },
  },
} as const satisfies Record<
  AppLocale,
  { reconcileNote: string; presets: Record<SpendingPreset, string> }
>
