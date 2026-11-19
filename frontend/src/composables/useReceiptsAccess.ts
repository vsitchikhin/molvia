import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import {
  modelAlone,
  monthOf,
  nextMonth,
  photoReceiptCountrySchema,
  receiptsClosedBy,
} from '@molvia/model'
import type { PhotoReceiptCountry, ReceiptsAccess, ReceiptsClosed } from '@molvia/model'
import { calendarDay } from '@/days'
import { useActorStore } from '@/stores/actor'
import { useFf } from '@/stores/ff'
import { read, write } from '@/stores/storage'

/** What the person chose in «Пробные чеки закончились»: the camera all the same, the record by hand, a word to the developer. */
export type ReceiptsClosedWay = 'photo' | 'manual' | 'developer'

/** What the sheet «Пробные чеки закончились» was shown for on this phone, per owner (MOL-276, В-1 «а»). */
const TOLD_KEY = 'molvia.receipts-told'

interface Told {
  /** The trial's end was said: once ever, it does not come back. */
  readonly trial?: boolean
  /** The paid reading whose end was said, by its moment (adversarial А2): once for each grant that runs out. */
  readonly ended?: string
  /** The month whose hundred was said (`YYYY-MM-01`): once a month. */
  readonly month?: string
}

function toldOf(owner: string): Told {
  try {
    const raw = read(`${TOLD_KEY}.${owner}`)
    const kept = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    return {
      ...(kept.trial === true ? { trial: true } : {}),
      ...(typeof kept.ended === 'string' ? { ended: kept.ended } : {}),
      ...(typeof kept.month === 'string' ? { month: kept.month } : {}),
    }
  } catch {
    // Unreadable is never said: the sheet comes once more.
    return {}
  }
}

/** What a reason says was told, of these figures: the trial at all, a grant by its end, the hundred by its month. */
function toldNow(reason: ReceiptsClosed, figures: ReceiptsAccess): Told {
  if (reason === 'trial') return { trial: true }
  if (reason === 'ended') return { ended: figures.ended?.toISOString() ?? '' }
  return { month: figures.month }
}

/**
 * The figures of the month's hundred in words (review №3): the month's name, the hundred and the first of the next
 * month — one place for the status of «Настройки» and the sheet, so the two never part.
 */
export function monthWords(
  access: ReceiptsAccess,
  t: (key: string) => string,
  locale: string,
): { month: string; limit: number; next: string } {
  return {
    month: t(`spending.month_in.${access.month.slice(5, 7)}`),
    limit: access.limit,
    next: calendarDay(`${nextMonth(monthOf(access.month))}-01`, locale),
  }
}

/**
 * Where the person stands with the model that reads receipts (MOL-276): the server's figures as `/actors/me` last
 * said them (`receiptsAccess`), the reason the model reads no more (`receiptsClosedBy`, the domain's) and whether
 * anyone reads in its place — Tesseract, while the фф `payments` is off, in a country it reads (MOL-275, В-1 «в»).
 * Only for a country whose receipts are read off the photo: Serbia's come by their link, and the model reads none.
 */
export function useReceiptsAccess(): {
  /** The country of the settings when its receipts are read off the photo, else none — no status there. */
  readonly country: ComputedRef<PhotoReceiptCountry | null>
  /** The server's figures; none where it has not said them — a launch offline, a server before MOL-275. */
  readonly access: ComputedRef<ReceiptsAccess | null>
  readonly closed: ComputedRef<ReceiptsClosed | null>
  /** With the model closed, Tesseract still reads the receipt (В-1): the camera stays a way on. */
  readonly othersRead: ComputedRef<boolean>
  /**
   * Whether a tap on «Сфотографировать чек» meets the sheet first (В-1 «а»): at every tap where nobody would read
   * the receipt, else once — the trial once ever, a grant run out once for each, the month's hundred once a month.
   * Only asks: the sheet shown is marked by `told` (review №1).
   */
  readonly sheetFirst: () => boolean
  /** Marks the sheet shown for the reason it stands for now, where it is shown once. */
  readonly told: () => void
  /**
   * Asks `/actors/me` again, quietly (Р-3): as the app comes back into view and at midnight with a screen in view
   * (adversarial А3) — a month's hundred opens again on the 1st. `verify` asks once for everyone who asks with it.
   */
  readonly askAgain: () => void
} {
  const actor = useActorStore()
  const payments = useFf('payments')
  const country = computed(() => {
    const parsed = photoReceiptCountrySchema.safeParse(actor.settings?.country)
    return parsed.success ? parsed.data : null
  })
  const access = computed(() => (country.value ? (actor.actor?.receiptsAccess ?? null) : null))
  const closed = computed(() => (access.value ? receiptsClosedBy(access.value) : null))
  const othersRead = computed(
    () => !payments.value && country.value !== null && !modelAlone(country.value),
  )

  function sheetFirst(): boolean {
    const reason = closed.value
    const figures = access.value
    const owner = actor.id
    if (!reason || !figures || !owner) return false
    if (!othersRead.value) return true
    const said = toldNow(reason, figures)
    const kept = toldOf(owner)
    if (reason === 'trial') return kept.trial !== true
    if (reason === 'ended') return kept.ended !== said.ended
    return kept.month !== said.month
  }

  function told(): void {
    const reason = closed.value
    const figures = access.value
    const owner = actor.id
    if (!reason || !figures || !owner || !othersRead.value) return
    write(`${TOLD_KEY}.${owner}`, JSON.stringify({ ...toldOf(owner), ...toldNow(reason, figures) }))
  }

  function askAgain(): void {
    if (actor.state === 'ready' && navigator.onLine) void actor.verify()
  }

  return { country, access, closed, othersRead, sheetFirst, told, askAgain }
}
