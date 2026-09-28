import { computed, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { Currency, MoneyAccountView } from '@molvia/model'
import { defaultAccount, pageOrder } from '@/components/accounts'
import { useAccountsStore } from '@/stores/accounts'

export interface AccountChoice {
  readonly accountId: Ref<string | null>
  readonly account: ComputedRef<MoneyAccountView | null>
  /** The row is drawn: the owner has an account, or the operation is on one already. */
  readonly shows: ComputedRef<boolean>
  /** A new operation starts on the default; an amendment on the account it was written with. */
  readonly reset: (initial: string | null | undefined) => void
  readonly pick: (id: string | null) => void
}

/**
 * The account of one side of an operation in its sheet (MOL-123, handoff 06): the first live account
 * of the operation's currency in the order of «Счета», following the currency until the person
 * chooses — then the choice holds. The screen puts it in; the server never guesses (Р-13 MOL-115).
 */
export function useAccountChoice(currency: Ref<Currency>, strict = false): AccountChoice {
  const store = useAccountsStore()
  const accountId = ref<string | null>(null)
  const byHand = ref(false)
  const account = computed(() => store.accounts.find(({ id }) => id === accountId.value) ?? null)

  function follow(): void {
    // Money lands on an account in its own currency or not at all (Р-31 MOL-115): a choice the new
    // currency does not fit goes back to the default, rather than being written «без счёта» unseen.
    const held = account.value
    if (strict && held && held.currency !== currency.value) byHand.value = false
    if (!byHand.value) accountId.value = defaultAccount(store.accounts, currency.value)?.id ?? null
  }
  watch([currency, () => store.accounts], follow)

  return {
    accountId,
    account,
    shows: computed(() => pageOrder(store.accounts).length > 0 || account.value !== null),
    reset: (initial) => {
      byHand.value = initial !== undefined
      accountId.value = initial ?? null
      follow()
    },
    pick: (id) => {
      byHand.value = true
      accountId.value = id
    },
  }
}
