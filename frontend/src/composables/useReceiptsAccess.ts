import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { modelAlone, photoReceiptCountrySchema, receiptsClosedBy } from '@molvia/model'
import type { PhotoReceiptCountry, ReceiptsAccess } from '@molvia/model'
import { shiftDay } from '@/days'
import { useActorStore } from '@/stores/actor'
import { useFf } from '@/stores/ff'
import { read, write } from '@/stores/storage'

/** What the sheet «Пробные чеки закончились» was shown for on this phone, per owner (MOL-276, В-1 «а»). */
const TOLD_KEY = 'molvia.receipts-told'

interface Told {
  /** The trial's end was said: once ever, it does not come back. */
  readonly trial?: boolean
  /** The month whose hundred was said (`YYYY-MM-01`): once a month. */
  readonly month?: string
}

/** The first day of the month after `month` (`YYYY-MM-01`): 31 days on from a first always land in the next. */
export function nextMonth(month: string): string {
  return `${shiftDay(month, 31).slice(0, 8)}01`
}

function toldOf(owner: string): Told {
  try {
    const raw = read(`${TOLD_KEY}.${owner}`)
    const kept = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    return {
      ...(kept.trial === true ? { trial: true } : {}),
      ...(typeof kept.month === 'string' ? { month: kept.month } : {}),
    }
  } catch {
    // Unreadable is never said: the sheet comes once more.
    return {}
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
  readonly closed: ComputedRef<'trial' | 'month' | null>
  /** With the model closed, Tesseract still reads the receipt (В-1): the camera stays a way on. */
  readonly othersRead: ComputedRef<boolean>
  /**
   * Whether a tap on «Сфотографировать чек» meets the sheet first (В-1 «а»): at every tap where nobody would read
   * the receipt, else once — the trial once ever, the month's hundred once a month — and marked so as it is asked.
   */
  sheetFirst(): boolean
} {
  const actor = useActorStore()
  const payments = useFf('payments')
  const country = computed(() => {
    const parsed = photoReceiptCountrySchema.safeParse(actor.settings?.country)
    return parsed.success ? parsed.data : null
  })
  const access = computed(() => (country.value && actor.actor?.receiptsAccess) || null)
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
    const told = toldOf(owner)
    if (reason === 'trial' ? told.trial === true : told.month === figures.month) return false
    write(
      `${TOLD_KEY}.${owner}`,
      JSON.stringify(
        reason === 'trial' ? { ...told, trial: true } : { ...told, month: figures.month },
      ),
    )
    return true
  }

  return { country, access, closed, othersRead, sheetFirst }
}
