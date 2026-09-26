import { beforeEach, describe, expect, it } from 'vitest'
import { forgetOwner } from '@/stores/identity'
import { dropSearchDraft, keepSearchDraft, recallSearchDraft } from '@/stores/searchDraft'

const OWNER = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const OTHER = '0b6f6c1e-3f7a-4c2b-9a53-5b8a5d1e2f00'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('the search typed, across a reload (MOL-46)', () => {
  it('gives back the query and the miss it was handed', () => {
    keepSearchDraft(OWNER, { query: 'мацони', missed: 'кефир' })
    expect(recallSearchDraft(OWNER)).toEqual({ query: 'мацони', missed: 'кефир' })
  })

  it('keeps it on this window’s shelf only — another window must not come up with it', () => {
    keepSearchDraft(OWNER, { query: 'кефир', missed: null })
    expect(localStorage.length).toBe(0)
  })

  it('is the owner’s: another one recalls nothing', () => {
    keepSearchDraft(OWNER, { query: 'кефир', missed: null })
    expect(recallSearchDraft(OTHER)).toBeNull()
    expect(recallSearchDraft(null)).toBeNull()
  })

  it('writes nothing for an empty field with no miss, and removes what was there', () => {
    keepSearchDraft(OWNER, { query: 'кефир', missed: null })
    keepSearchDraft(OWNER, { query: '', missed: null })
    expect(sessionStorage.length).toBe(0)
  })

  it('keeps a miss through an erased field — the next pick still learns from it', () => {
    keepSearchDraft(OWNER, { query: '', missed: 'кефир' })
    expect(recallSearchDraft(OWNER)).toEqual({ query: '', missed: 'кефир' })
  })

  it('reads a shelf it cannot parse as nothing', () => {
    sessionStorage.setItem(`molvia.search-draft.${OWNER}`, '{not json')
    expect(recallSearchDraft(OWNER)).toBeNull()
    sessionStorage.setItem(`molvia.search-draft.${OWNER}`, JSON.stringify({ query: 7 }))
    expect(recallSearchDraft(OWNER)).toBeNull()
  })

  it('is put away with the screen, and with the owner on «Выйти»', () => {
    keepSearchDraft(OWNER, { query: 'кефир', missed: null })
    dropSearchDraft(OWNER)
    expect(recallSearchDraft(OWNER)).toBeNull()

    keepSearchDraft(OWNER, { query: 'кефир', missed: null })
    forgetOwner(OWNER)
    expect(recallSearchDraft(OWNER)).toBeNull()
  })
})
