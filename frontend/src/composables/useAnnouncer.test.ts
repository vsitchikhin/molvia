import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, type Ref } from 'vue'
import { provideAnnouncer, useAnnouncer } from '@/composables/useAnnouncer'

type Announce = NonNullable<ReturnType<typeof useAnnouncer>>

function app() {
  let announce: Announce | undefined
  let region: Ref<{ id: number; text: string }[]> | undefined
  const Child = defineComponent({
    setup() {
      announce = useAnnouncer()
      return () => null
    },
  })
  mount({
    setup() {
      region = provideAnnouncer()
      return () => h(Child)
    },
  })
  if (!announce || !region) throw new Error('the announcer did not reach the child')
  const current = region
  return { announce, texts: () => current.value.map((announcement) => announcement.text) }
}

describe('the app live region', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // A region and its words changed in one task are one change to a screen reader, and a
  // region born with its words is often not read (MOL-19, П-2, C2).
  it('says nothing in the task it was asked, and says it in a later one', () => {
    const { announce, texts } = app()
    announce('Loading…')
    expect(texts()).toEqual([])
    vi.advanceTimersByTime(100)
    expect(texts()).toEqual(['Loading…'])
  })

  // An addition is what gets read; the same words as a new node are read again (C1).
  it('makes each announcement a node of its own, the same words included', () => {
    const { announce, texts } = app()
    announce('The server did not answer')
    announce('The server did not answer')
    vi.advanceTimersByTime(100)
    expect(texts()).toEqual(['The server did not answer', 'The server did not answer'])
  })

  it('takes words back when asked, before or after they were said', () => {
    const { announce, texts } = app()
    const early = announce('Early')
    early()
    const late = announce('Late')
    vi.advanceTimersByTime(100)
    expect(texts()).toEqual(['Late'])
    late()
    expect(texts()).toEqual([])
  })

  // Hidden but in the reading order: words left in it are found in browse mode as if still true.
  it('lets words go by themselves once they have been read', () => {
    const { announce, texts } = app()
    announce('Loading…')
    vi.advanceTimersByTime(100)
    vi.advanceTimersByTime(6999)
    expect(texts()).toEqual(['Loading…'])
    vi.advanceTimersByTime(1)
    expect(texts()).toEqual([])
  })

  it('is not there outside the app, so a block speaks for itself', () => {
    let announce: ReturnType<typeof useAnnouncer> = () => () => undefined
    mount({
      setup() {
        announce = useAnnouncer()
        return () => null
      },
    })
    expect(announce).toBeUndefined()
  })
})
