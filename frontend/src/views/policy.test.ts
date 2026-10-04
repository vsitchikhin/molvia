import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { POLICY_VERSION } from '@molvia/model'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { POLICY_REVISION, PRIVACY_PARTS, PRIVACY_STORED, TERMS_PARTS } from './policy'

/**
 * Both pages in both languages, as they are filed, and the parts each shows — any edit, a comma or
 * a part taken out included, changes it.
 */
function digestOfPages(): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        [PRIVACY_STORED, PRIVACY_PARTS, TERMS_PARTS],
        [ru.privacy, ru.terms, en.privacy, en.terms],
      ]),
    )
    .digest('hex')
}

describe('the revision of the terms and the privacy page (MOL-95, В-1)', () => {
  it('moves with every edit of their text', () => {
    expect(
      digestOfPages(),
      'The text of «Данные и приватность» or «Условия использования» changed. Set POLICY_REVISION in ' +
        'frontend/src/views/policy.ts to today and this digest. If the change matters — a new kind ' +
        'of data, a new recipient, a new purpose, a change of the terms — raise POLICY_VERSION in ' +
        'packages/model/src/contracts/consent.ts as well, and write consent.changes.<version>.',
    ).toBe(POLICY_REVISION.digest)
  })

  it('names the edition the model asks about, so raising it is an edit of the revision too', () => {
    expect(POLICY_REVISION.version).toBe(POLICY_VERSION)
  })

  it('is a calendar day', () => {
    expect(POLICY_REVISION.day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(new Date(`${POLICY_REVISION.day}T00:00:00Z`).toISOString().slice(0, 10)).toBe(
      POLICY_REVISION.day,
    )
  })

  it('says what changed in every language once there was an edition before', () => {
    // The screen «Условия обновились» names the change of the edition it asks about.
    const changes = (dictionary: object) =>
      (dictionary as { consent: { changes?: Record<string, string> } }).consent.changes
    const version: number = POLICY_VERSION
    for (const dictionary of [ru, en]) {
      if (version > 1) expect(changes(dictionary)?.[String(version)]).toBeTruthy()
      else expect(changes(dictionary)).toBeUndefined()
    }
  })
})
