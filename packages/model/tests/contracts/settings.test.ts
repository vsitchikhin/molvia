import { describe, expect, it } from 'vitest'
import { SETTINGS_CITIES, settingsCityOf } from '#model/contracts/settings'

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
})
