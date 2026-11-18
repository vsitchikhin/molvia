import { describe, expect, it } from 'vitest'
import {
  citiesOf,
  COUNTRY_CITIES,
  firstGeography,
  geographyAllowed,
  SETTINGS_CITIES,
  SETTINGS_COUNTRIES,
  settingsCityOf,
  settingsUpdateSchema,
} from '#model/contracts/settings'

describe('settingsCityOf (MOL-120, adversarial А2)', () => {
  it('reads a city of the settings in any spelling the index over `places` folds to it', () => {
    expect(settingsCityOf('Гюмри')).toBe('Гюмри')
    // A place keeps its city as it was first written: «гюмри» is Gyumri to the index.
    expect(settingsCityOf('гюмри')).toBe('Гюмри')
    expect(settingsCityOf(' ЕРЕВАН ')).toBe('Ереван')
  })

  it('is every city of the settings, and nothing else', () => {
    for (const city of SETTINGS_CITIES) expect(settingsCityOf(city)).toBe(city)
    expect(settingsCityOf('Ванадзор')).toBeNull()
    expect(settingsCityOf('Gyumri')).toBeNull()
    expect(settingsCityOf('toString')).toBeNull()
  })

  it('reads the cities of Georgia and Serbia too (MOL-109)', () => {
    expect(settingsCityOf('батуми')).toBe('Батуми')
    expect(settingsCityOf('Нови-сад')).toBe('Нови-Сад')
    // a hyphen is a letter of the name, not a space: «Нови Сад» is another spelling, not this city
    expect(settingsCityOf('Нови Сад')).toBeNull()
  })

  it('reads the cities of Russia too (MOL-412)', () => {
    expect(settingsCityOf('санкт-петербург')).toBe('Санкт-Петербург')
    expect(settingsCityOf(' МОСКВА ')).toBe('Москва')
    // the short name is another spelling, not this city
    expect(settingsCityOf('Петербург')).toBeNull()
  })
})

describe('the countries of the settings and their cities (MOL-109)', () => {
  it('offers Armenia, Georgia, Russia and Serbia, in the order of their names, Gyumri first as before', () => {
    expect(SETTINGS_COUNTRIES).toEqual(['AM', 'GE', 'RU', 'RS'])
    expect(citiesOf('AM')).toEqual(['Гюмри', 'Ереван'])
    expect(citiesOf('GE')).toEqual(['Тбилиси', 'Батуми'])
    expect(citiesOf('RS')).toEqual(['Белград', 'Нови-Сад'])
    expect(SETTINGS_CITIES).toEqual(SETTINGS_COUNTRIES.flatMap((country) => citiesOf(country)))
  })

  it('offers Russia seven cities of Moscow’s time, Moscow first (MOL-412)', () => {
    expect(citiesOf('RU')).toEqual([
      'Москва',
      'Санкт-Петербург',
      'Волгоград',
      'Казань',
      'Краснодар',
      'Сочи',
      'Домбай',
    ])
  })

  it('has no cities for a country it does not offer, nor for a key of Object', () => {
    expect(citiesOf('KZ')).toEqual([])
    expect(citiesOf('am')).toEqual([])
    expect(citiesOf('ru')).toEqual([])
    expect(citiesOf('constructor')).toEqual([])
    expect(citiesOf('__proto__')).toEqual([])
  })

  it('names no city in two countries: a city is one country', () => {
    expect(new Set(SETTINGS_CITIES).size).toBe(SETTINGS_CITIES.length)
  })
})

describe('geographyAllowed (MOL-65, MOL-109)', () => {
  const held = { country: 'AM', city: 'Гюмри' }

  it('takes a city of its own country, in every country', () => {
    for (const country of SETTINGS_COUNTRIES) {
      for (const city of COUNTRY_CITIES[country]) {
        expect(geographyAllowed({ country, city }, held), `${country}/${city}`).toBe(true)
      }
    }
  })

  it('refuses a city of the settings under another country', () => {
    expect(geographyAllowed({ country: 'AM', city: 'Тбилиси' }, held)).toBe(false)
    expect(geographyAllowed({ country: 'GE', city: 'Гюмри' }, held)).toBe(false)
    expect(geographyAllowed({ country: 'RS', city: 'Батуми' }, held)).toBe(false)
    expect(geographyAllowed({ country: 'RU', city: 'Гюмри' }, held)).toBe(false)
    expect(geographyAllowed({ country: 'AM', city: 'Москва' }, held)).toBe(false)
  })

  it('refuses a city the settings do not offer, unless the person already has exactly it', () => {
    expect(geographyAllowed({ country: 'GE', city: 'Кутаиси' }, held)).toBe(false)
    expect(geographyAllowed({ country: 'KZ', city: 'Алматы' }, held)).toBe(false)
    expect(geographyAllowed({ country: 'RU', city: 'Самара' }, held)).toBe(false)
    const almaty = { country: 'KZ', city: 'Алматы' }
    expect(geographyAllowed(almaty, almaty)).toBe(true)
    expect(geographyAllowed({ country: 'KZ', city: 'Астана' }, almaty)).toBe(false)
  })

  it('is the rule of a settings update', () => {
    const previous = { ...held, spendCurrency: 'AMD', incomeCurrency: 'RUB' } as const
    const parse = (country: string, city: string) =>
      settingsUpdateSchema.safeParse({ previous, settings: { ...previous, country, city } }).success
    expect(parse('RS', 'Нови-Сад')).toBe(true)
    expect(parse('RU', 'Домбай')).toBe(true)
    expect(parse('GE', 'Белград')).toBe(false)
    expect(parse('RU', 'Ереван')).toBe(false)
  })
})

describe('firstGeography (MOL-109, В-3)', () => {
  it('starts a newcomer in the country their phone lives in, at its first city', () => {
    expect(firstGeography('Asia/Tbilisi')).toEqual({ country: 'GE', city: 'Тбилиси' })
    expect(firstGeography('Europe/Belgrade')).toEqual({ country: 'RS', city: 'Белград' })
    expect(firstGeography('Asia/Yerevan')).toEqual({ country: 'AM', city: 'Гюмри' })
    expect(firstGeography('Europe/Moscow')).toEqual({ country: 'RU', city: 'Москва' })
  })

  it('takes a phone of Volgograd’s own zone to Moscow (MOL-412)', () => {
    expect(firstGeography('Europe/Volgograd')).toEqual({ country: 'RU', city: 'Москва' })
  })

  it('starts everyone else in Gyumri, as every account began before', () => {
    expect(firstGeography(undefined)).toEqual({ country: 'AM', city: 'Гюмри' })
    // Russia's zones beyond Moscow's clock are MOL-419's, and Kirov's is no city of the settings
    expect(firstGeography('Europe/Samara')).toEqual({ country: 'AM', city: 'Гюмри' })
    expect(firstGeography('Asia/Yekaterinburg')).toEqual({ country: 'AM', city: 'Гюмри' })
    expect(firstGeography('Europe/Kirov')).toEqual({ country: 'AM', city: 'Гюмри' })
    // a zone of the same offset is another country: Baku and Dubai are not Georgia
    expect(firstGeography('Asia/Baku')).toEqual({ country: 'AM', city: 'Гюмри' })
    expect(firstGeography('')).toEqual({ country: 'AM', city: 'Гюмри' })
  })
})
