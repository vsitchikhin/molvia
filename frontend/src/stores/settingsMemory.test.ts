import { beforeEach, describe, expect, it } from 'vitest'
import type { ActorSettings } from '@molvia/model'
import { recallSettingsSnapshot, rememberSettings, settingsKey } from '@/stores/settingsMemory'

const OWNER = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const SETTINGS: ActorSettings = {
  country: 'AM',
  city: 'Гюмри',
  spendCurrency: 'AMD',
  incomeCurrency: 'RUB',
}
const UPDATED = new Date('2026-10-01T08:00:00.000Z')
const READ = new Date('2026-10-31T10:05:00.000Z')

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('the moment the server said the settings (MOL-215)', () => {
  it('is kept beside them and read back', () => {
    rememberSettings(OWNER, SETTINGS, UPDATED, READ)

    expect(recallSettingsSnapshot(OWNER)).toEqual({
      settings: SETTINGS,
      updatedAt: UPDATED,
      readAt: READ,
    })
  })

  it('is unknown on a shelf written by the build before it', () => {
    // The previous build writes the envelope with no `readAt`: the settings still read, the time not.
    localStorage.setItem(
      settingsKey(OWNER),
      JSON.stringify({ settings: SETTINGS, updatedAt: UPDATED.toISOString() }),
    )

    expect(recallSettingsSnapshot(OWNER)).toEqual({
      settings: SETTINGS,
      updatedAt: UPDATED,
      readAt: null,
    })
  })

  it('is unknown when nothing was heard, and is then not written at all', () => {
    rememberSettings(OWNER, SETTINGS, UPDATED, null)

    expect(JSON.parse(localStorage.getItem(settingsKey(OWNER)) ?? '{}')).not.toHaveProperty(
      'readAt',
    )
    expect(recallSettingsSnapshot(OWNER)?.readAt).toBeNull()
  })

  it('is unknown when it is no moment, and the settings still read', () => {
    localStorage.setItem(
      settingsKey(OWNER),
      JSON.stringify({ settings: SETTINGS, updatedAt: UPDATED.toISOString(), readAt: 'вчера' }),
    )

    expect(recallSettingsSnapshot(OWNER)).toEqual({
      settings: SETTINGS,
      updatedAt: UPDATED,
      readAt: null,
    })
  })

  it('leaves the envelope as the build before reads it', () => {
    // That build takes `settings` and `updatedAt` and looks at nothing else.
    rememberSettings(OWNER, SETTINGS, UPDATED, READ)
    const raw = JSON.parse(localStorage.getItem(settingsKey(OWNER)) ?? '{}') as Record<
      string,
      unknown
    >

    expect(raw.settings).toEqual(SETTINGS)
    expect(raw.updatedAt).toBe(UPDATED.toISOString())
  })
})
