<template>
  <BottomSheet :open="open" :on-closed="afterClose" @update:open="$emit('update:open', $event)">
    <template #title>{{
      t(account ? 'accounts.sheet.title_edit' : 'accounts.sheet.title_add')
    }}</template>
    <template #meta>{{ meta }}</template>

    <form class="form" novalidate @submit.prevent="submit">
      <p v-if="!online" class="strip">
        <IconCloudOff class="strip-icon" aria-hidden="true" />{{ t('accounts.sheet.offline') }}
      </p>

      <AppField
        ref="nameField"
        v-model="name"
        :label="t('accounts.sheet.name')"
        :placeholder="t('accounts.sheet.name_placeholder')"
        :maxlength="nameMax"
        :error-text="nameProblem"
        enterkeyhint="next"
        autocomplete="off"
        @update:model-value="nameProblem = null"
      />

      <div v-if="locked" class="locked">
        <p class="label">{{ t('accounts.sheet.currency') }}</p>
        <p class="lock">
          <IconLock class="lock-icon" aria-hidden="true" />{{ currencyName(currency) }}
        </p>
        <p class="hint">{{ t('error.money_account_currency_locked') }}</p>
      </div>
      <AppField
        v-else
        v-model="currency"
        :label="t('accounts.sheet.currency')"
        kind="select"
        :options="currencyOptions"
      />

      <div>
        <SegmentedControl v-model="kind" :options="kinds" :legend="t('accounts.sheet.kind')" />
        <p class="hint">{{ t('accounts.sheet.kind_hint') }}</p>
      </div>

      <AppField
        ref="startField"
        v-model="start"
        :label="t('accounts.balance')"
        kind="decimal"
        :error-text="startBad ? t('accounts.sheet.bad_start') : null"
        enterkeyhint="done"
        @update:model-value="startBad = false"
      >
        <template #suffix>{{ sign(currency) }}</template>
      </AppField>

      <div>
        <AppField
          v-model="startOn"
          :label="t('accounts.sheet.start_day')"
          kind="date"
          min="2000-01-02"
          :max="today"
          :display="dayWords"
          :error-text="dayProblem"
          @update:model-value="dayProblem = null"
        />
        <p class="hint">{{ t('accounts.sheet.start_hint') }}</p>
      </div>
    </form>

    <template #footer>
      <p v-if="failed" class="failed" role="alert">{{ t('accounts.sheet.failed') }}</p>
      <div v-if="conflict && account" class="failed" role="alert">
        <p class="conflict">{{ t('accounts.sheet.conflict') }}</p>
        <p class="conflict current">{{ currentOf(account) }}</p>
      </div>
      <AppButton size="large" block :busy="sending" :disabled="sending || !online" @click="submit">
        <template #icon><IconCheck v-if="online" /><IconCloudOff v-else /></template>
        {{ online ? t('accounts.sheet.save') : t('accounts.sheet.wait_online') }}
      </AppButton>
      <template v-if="account">
        <AppButton variant="danger-ghost" block :disabled="sending || !online" @click="remove">
          <template #icon>
            <IconArchive v-if="account.hasOperations" /><IconDelete v-else />
          </template>
          {{ t(account.hasOperations ? 'accounts.sheet.archive' : 'accounts.sheet.delete') }}
        </AppButton>
        <p class="note">
          {{
            t(account.hasOperations ? 'accounts.sheet.archive_note' : 'accounts.sheet.delete_note')
          }}
        </p>
      </template>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, ref, watch } from 'vue'
import type { ComponentPublicInstance, PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconArchive from '~icons/mdi/archive-arrow-down-outline'
import IconCheck from '~icons/mdi/check'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import IconDelete from '~icons/mdi/trash-can-outline'
import IconLock from '~icons/mdi/lock-outline'
import { ApiError } from '@molvia/client'
import {
  ERROR,
  MONEY_ACCOUNT_NAME_MAX,
  currencySchema,
  currencySign,
  decimalFromMinor,
  moneyAccountNameSchema,
  nameIdentity,
  yerevanDate,
} from '@molvia/model'
import type { Currency, MoneyAccountView, MoneyAccountsResponse } from '@molvia/model'
import { api } from '@/api'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { parseSigned, shortDay, signedAmount } from '@/components/accounts'
import { shown } from '@/composables/useItemDetails'
import { calendarDay, shiftDay } from '@/days'
import { newId } from '@/ids'
import { useAccountsStore } from '@/stores/accounts'

type Kind = 'spending' | 'savings'

/** What the sheet hands the screen once it has closed: which of the three it was. */
export type AccountOutcome =
  | { readonly kind: 'added' | 'saved'; readonly name: string }
  | { readonly kind: 'deleted' | 'archived'; readonly id: string; readonly name: string }

/**
 * «Новый счёт» and «Счёт» (MOL-123, handoff 03): where money lies, and what it held at the end of a
 * day. Written with a connection only, as an exchange is — no queue: an account is set up at home,
 * and a balance offline would be a guess. Named by the device once per opening, so «Сохранить»
 * again after a lost answer is the same account. Checked on «Сохранить», never under the finger;
 * the server checks the same and wins. «Удалить» or «Убрать из выбора» is the server's to decide
 * (`hasOperations`), and whichever it was, the answer is the page whole.
 */
export default defineComponent({
  name: 'AccountSheet',
  components: {
    AppButton,
    AppField,
    BottomSheet,
    IconArchive,
    IconCheck,
    IconCloudOff,
    IconDelete,
    IconLock,
    SegmentedControl,
  },
  props: {
    open: { type: Boolean, required: true },
    /** The account amended, or null for a new one. */
    account: { type: Object as PropType<MoneyAccountView | null>, default: null },
    /** A new account starts in the currency purchases are written in (handoff 03). */
    spendCurrency: { type: String as PropType<Currency>, required: true },
    online: { type: Boolean, default: true },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    done: (outcome: AccountOutcome) => typeof outcome === 'object',
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const store = useAccountsStore()

    const name = ref('')
    const currency = ref<Currency>('AMD')
    const kind = ref<Kind>('spending')
    const start = ref('')
    const today = ref(yerevanDate(new Date()))
    const startOn = ref(today.value)
    const nameProblem = ref<string | null>(null)
    const startBad = ref(false)
    const dayProblem = ref<string | null>(null)
    const sending = ref(false)
    const failed = ref(false)
    const conflict = ref(false)
    let accountId = newId()
    const nameField = ref<ComponentPublicInstance | null>(null)
    const startField = ref<ComponentPublicInstance | null>(null)

    /** The amount as it would be typed back: «241530», «-12400,5», never the grouping spaces. */
    function typed(account: MoneyAccountView): string {
      return shown(decimalFromMinor(account.start), locale.value === 'ru' ? ',' : '.')
    }

    watch(
      () => props.open,
      (open) => {
        if (!open) return
        const account = props.account
        today.value = yerevanDate(new Date())
        name.value = account?.name ?? ''
        currency.value = account?.currency ?? props.spendCurrency
        kind.value = account?.savings ? 'savings' : 'spending'
        start.value = account ? typed(account) : ''
        startOn.value = account?.startOn ?? today.value
        nameProblem.value = null
        startBad.value = false
        dayProblem.value = null
        failed.value = false
        conflict.value = false
        if (!account) accountId = newId()
      },
      { immediate: true },
    )

    /** The one the screen holds now — after a conflict, the version another device wrote. */
    const current = computed(() =>
      props.account ? (store.accounts.find(({ id }) => id === props.account?.id) ?? null) : null,
    )
    const locked = computed(() => current.value?.hasOperations === true)

    const meta = computed(() => {
      const account = current.value
      if (!account) return t('accounts.sheet.meta_add')
      return account.hasOperations
        ? t('accounts.sheet.meta_has_ops', { date: shortDay(account.startOn, locale.value) })
        : t('accounts.no_operations')
    })

    const sign = (value: Currency) => currencySign(value, locale.value)
    const currencyName = (value: Currency) =>
      t('accounts.sheet.currency_option', {
        name: t(`spending.currency_name.${value}`),
        code: value,
      })
    const currencyOptions = currencySchema.options.map((value) => ({
      value,
      label: currencyName(value),
    }))
    const kinds = computed(() => [
      { value: 'spending', label: t('accounts.for_spending') },
      { value: 'savings', label: t('accounts.savings') },
    ])

    const dayWords = computed(() => {
      if (!startOn.value) return null
      const date = calendarDay(startOn.value, locale.value)
      if (startOn.value === today.value) return t('spending.sheet.date_today', { date })
      if (startOn.value === shiftDay(today.value, -1))
        return t('spending.sheet.date_yesterday', { date })
      return date
    })

    /** «Сейчас записано»: the version the other device wrote, so the next save is not blind. */
    function currentOf(account: MoneyAccountView): string {
      const held = current.value ?? account
      return [
        held.name,
        signedAmount(held.start, locale.value),
        shortDay(held.startOn, locale.value),
      ].join(' · ')
    }

    /** A name already taken by another account of the owner's, live or removed (Р-21 MOL-115). */
    function takenBy(text: string): MoneyAccountView | null {
      const identity = nameIdentity(text)
      return (
        store.accounts.find(
          (account) => account.id !== props.account?.id && nameIdentity(account.name) === identity,
        ) ?? null
      )
    }

    async function focusFirstProblem(): Promise<void> {
      await nextTick()
      const field = nameProblem.value ? nameField.value : startBad.value ? startField.value : null
      ;(field?.$el as HTMLElement | undefined)?.querySelector<HTMLElement>('input')?.focus()
    }

    /**
     * Told once the sheet is away (`onClosed`), never while its step back is on its way: a screen
     * that moves on the answer — «Удалить» on the account's own screen leads to «Счета» — had its
     * move undone by the pop that closed the sheet.
     */
    let outcome: AccountOutcome | null = null
    function finished(done: AccountOutcome): void {
      outcome = done
      emit('update:open', false)
    }
    function afterClose(): void {
      const done = outcome
      outcome = null
      if (done) emit('done', done)
    }

    async function submit(): Promise<void> {
      if (sending.value || !props.online) return
      failed.value = false
      const typedName = name.value.trim()
      const parsedName = moneyAccountNameSchema.safeParse(typedName)
      nameProblem.value = !typedName
        ? t('accounts.sheet.no_name')
        : takenBy(typedName)
          ? t('accounts.sheet.name_taken', { name: typedName })
          : parsedName.success
            ? null
            : t('accounts.sheet.no_name')
      const balance = parseSigned(start.value, currency.value)
      startBad.value = balance === null
      dayProblem.value = startOn.value ? null : t('spending.sheet.bad_day')
      if (nameProblem.value || !balance || dayProblem.value) {
        void focusFirstProblem()
        return
      }
      const fields = {
        name: typedName,
        currency: currency.value,
        savings: kind.value === 'savings',
        start: balance,
        startOn: startOn.value,
      }
      sending.value = true
      try {
        let answer: MoneyAccountsResponse
        const held = current.value
        if (held) {
          answer = await api.amendMoneyAccount(held.id, { revision: held.revision, ...fields })
        } else {
          answer = await addOrAmend(fields)
        }
        store.accept(answer)
        finished({ kind: held ? 'saved' : 'added', name: typedName })
      } catch (caught) {
        const code = caught instanceof ApiError ? caught.code : null
        if (code === ERROR.MONEY_ACCOUNT_TAKEN) {
          nameProblem.value = t('accounts.sheet.name_taken', { name: typedName })
          void focusFirstProblem()
        } else if (code === ERROR.MONEY_ACCOUNT_IN_FUTURE) {
          dayProblem.value = t('error.money_account_in_future')
        } else if (code === ERROR.CONFLICT || code === ERROR.MONEY_ACCOUNT_CURRENCY_LOCKED) {
          // What was typed stays, and the next «Сохранить» goes over the version held now.
          conflict.value = true
          await store.refresh()
        } else {
          failed.value = true
        }
      } finally {
        sending.value = false
      }
    }

    /**
     * A new account, sent again after an answer that never came: the server holds it under this
     * name with the fields of the first attempt, and the 409 says so — it is this phone's own, so
     * what was typed since goes over it (the rule of a spending's record, MOL-82).
     */
    async function addOrAmend(fields: {
      name: string
      currency: Currency
      savings: boolean
      start: MoneyAccountView['start']
      startOn: string
    }): Promise<MoneyAccountsResponse> {
      try {
        return (await api.addMoneyAccount({ id: accountId, ...fields })).accounts
      } catch (caught) {
        if (!(caught instanceof ApiError) || caught.code !== ERROR.CONFLICT) throw caught
        const page = await api.moneyAccounts()
        const mine = page.accounts.find(({ id }) => id === accountId)
        if (!mine) throw caught
        return api.amendMoneyAccount(accountId, { revision: mine.revision, ...fields })
      }
    }

    async function remove(): Promise<void> {
      const account = current.value
      if (!account || sending.value || !props.online) return
      failed.value = false
      sending.value = true
      try {
        const answer = await api.removeMoneyAccount(account.id)
        store.accept(answer)
        const archived = answer.accounts.some(({ id }) => id === account.id)
        finished({ kind: archived ? 'archived' : 'deleted', id: account.id, name: account.name })
      } catch {
        failed.value = true
      } finally {
        sending.value = false
      }
    }

    return {
      t,
      name,
      nameMax: MONEY_ACCOUNT_NAME_MAX,
      currency,
      kind,
      kinds,
      start,
      startOn,
      today,
      dayWords,
      nameProblem,
      startBad,
      dayProblem,
      sending,
      failed,
      conflict,
      locked,
      meta,
      sign,
      currencyName,
      currencyOptions,
      currentOf,
      nameField,
      startField,
      submit,
      remove,
      afterClose,
    }
  },
})
</script>

<style scoped lang="scss">
.form {
  display: grid;
  gap: var(--space-4);
}

.strip {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3);
  border-radius: var(--radius);
  background: var(--warn-tint);
  color: var(--warn-ink);
  font-size: var(--text-footnote);
}

.strip-icon {
  flex: none;
  width: 1.125rem;
  height: 1.125rem;
}

.hint,
.note {
  margin: var(--space-2) 0 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.note {
  text-align: center;
}

.label {
  margin: 0 0 var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.lock {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--touch-target);
  margin: 0;
  padding: 0 var(--space-3);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text-muted);
}

.lock-icon {
  flex: none;
  width: 1.25rem;
  height: 1.25rem;
}

.failed {
  margin: 0 0 var(--space-2);
  color: var(--bad-ink);
  font-size: var(--text-footnote);
}

.conflict {
  margin: 0;
}

.current {
  color: var(--text);
}
</style>
