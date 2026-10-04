import {
  RECEIPT_NOTICES_PER_CLAIM,
  localClock,
  placeSchema,
  receiptNoticeSchema,
  tellsQuietly,
  timeZoneOf,
} from '@molvia/model'
import type {
  ChooseReceiptNotices,
  DueReceiptNotices,
  ReceiptNotice,
  ReceiptNoticesSetting,
} from '@molvia/model'
import type { ReceiptRepository, UntoldReceipt } from '@/db/receipts-repository'
import { withPlaces } from './receipts'

/** A receipt marked as told that the bot's contract would not read: the message is lost, and said. */
export class ReceiptNoticeUnreadable extends Error {
  readonly code = 'RECEIPT_NOTICE_UNREADABLE'

  constructor(cause: unknown) {
    super('receipt notice unreadable', { cause })
    this.name = 'ReceiptNoticeUnreadable'
  }
}

/**
 * «Чек разобран» (MOL-129): the receipts read that no phone was handed, marked as told and handed to
 * the bot to send. The API decides, the bot only sends (MOL-101 Р-1); a bot that dies between the two
 * loses the message, and nothing sends it twice.
 *
 * **What is handed over is what the bot's contract reads** — decided after the mark, since the mark
 * is the pick: a place whose stored name today's rule of visible text refuses goes as no place
 * (`parsed_no_place`); anything else the contract refuses is that one message lost and said through
 * `unreadable`, never a claim the bot cannot parse with the receipts of the minute in it.
 */
export async function claimReceiptNotices(
  receipts: Pick<ReceiptRepository, 'claimUntold' | 'placesOfTins'>,
  now: Date,
  unreadable: (failure: ReceiptNoticeUnreadable) => void,
): Promise<DueReceiptNotices> {
  const byActor = new Map<string, UntoldReceipt[]>()
  for (const one of await receipts.claimUntold(RECEIPT_NOTICES_PER_CLAIM)) {
    byActor.set(one.actor.id, [...(byActor.get(one.actor.id) ?? []), one])
  }
  const notices: ReceiptNotice[] = []
  for (const own of byActor.values()) {
    const [first] = own
    if (first === undefined) continue
    const placed = await withPlaces(receipts, first.actor, own)
    for (const [i, told] of own.entries()) {
      const notice = noticeOf(told, placed[i]?.place?.name ?? null, now)
      if (notice.success) notices.push(notice.data)
      else unreadable(new ReceiptNoticeUnreadable(notice.error))
    }
  }
  return { notices }
}

function noticeOf(told: UntoldReceipt, placeName: string | null, now: Date) {
  const { receipt, actor } = told
  // the person's day: their country's zone, else the receipt's — every country of the settings has one
  const zone = timeZoneOf(actor.country) ?? timeZoneOf(receipt.country) ?? 'UTC'
  const place = placeSchema.shape.name.safeParse(placeName)
  return receiptNoticeSchema.safeParse({
    telegramUserId: actor.telegramUserId,
    receiptId: receipt.id,
    outcome: receipt.status,
    language: receipt.language,
    place: place.success ? place.data : null,
    day: receipt.header?.date ?? localClock(receipt.capturedAt, zone).day,
    lineCount: receipt.lineCount,
    silent: tellsQuietly(now, zone),
  })
}

/** `GET /actors/me/receipt-notices` (MOL-129, В-2): whether «чек разобран» is turned off. */
export async function receiptNoticesOf(
  receipts: Pick<ReceiptRepository, 'noticesOff'>,
  owner: string,
): Promise<ReceiptNoticesSetting> {
  return { off: await receipts.noticesOff(owner) }
}

/**
 * `PUT /actors/me/receipt-notices`, saved on the tap. Turned on over a blocked bot it is on all the
 * same — the person's choice — and the page says why nothing comes: only an unblock lifts a block.
 */
export async function chooseReceiptNotices(
  receipts: Pick<ReceiptRepository, 'chooseNotices'>,
  owner: string,
  { on }: ChooseReceiptNotices,
): Promise<ReceiptNoticesSetting> {
  return { off: await receipts.chooseNotices(owner, !on) }
}
