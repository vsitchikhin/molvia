import type { TransferAmendBody, TransferBody, TransferView } from '@molvia/model'
import { api } from '@/api'
import { useAccountsStore } from '@/stores/accounts'

export interface Transfers {
  /** «Перевести»: the transfer as the server wrote it — the same one again after a lost answer. */
  readonly record: (body: TransferBody) => Promise<TransferView>
  readonly amend: (id: string, body: TransferAmendBody) => Promise<TransferView>
  readonly remove: (id: string) => Promise<void>
  readonly restore: (id: string) => Promise<TransferView>
  /** One transfer as its sheet opens it. */
  readonly load: (id: string) => Promise<TransferView>
  /**
   * A transfer changed with no answer of ours to say so — written already under its name, removed on
   * another phone: «Счета» read again, and the journals and the month told to (review Р2-1, А8, А9).
   */
  readonly heard: () => Promise<void>
}

/**
 * Transfers between one's own accounts (MOL-253), written with a connection as an exchange is —
 * never through a queue. Every write answers with «Счета» whole, taken into the store every screen
 * of accounts reads, and tells the journals and the month to read again: the two balances and the
 * fee are the server's.
 */
export function useTransfers(): Transfers {
  const accounts = useAccountsStore()

  function landed(page: Parameters<typeof accounts.accept>[0]): void {
    accounts.accept(page)
    accounts.transfers += 1
  }

  return {
    async record(body) {
      const { transfer } = await api.recordTransfer(body)
      landed(transfer.accounts)
      return transfer.transfer
    },
    async amend(id, body) {
      const answer = await api.amendTransfer(id, body)
      landed(answer.accounts)
      return answer.transfer
    },
    async remove(id) {
      landed(await api.removeTransfer(id))
    },
    async restore(id) {
      const answer = await api.restoreTransfer(id)
      landed(answer.accounts)
      return answer.transfer
    },
    load: (id) => api.transfer(id),
    async heard() {
      await accounts.refresh()
      accounts.transfers += 1
    },
  }
}
