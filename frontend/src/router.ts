import { START_LOCATION, createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw, RouterScrollBehavior } from 'vue-router'
import SettingsView from '@/views/SettingsView.vue'
import PrivacyView from '@/views/PrivacyView.vue'
import AdviceView from '@/views/AdviceView.vue'
import ItemSearchView from '@/views/ItemSearchView.vue'
import FinishedTripView from '@/views/FinishedTripView.vue'
import PurchasesView from '@/views/PurchasesView.vue'
import TripView from '@/views/TripView.vue'
import ExchangeView from '@/views/ExchangeView.vue'
import IncomesView from '@/views/IncomesView.vue'
import DevicesView from '@/views/DevicesView.vue'
import VerdictsView from '@/views/VerdictsView.vue'
import MoneySpendingsView from '@/views/MoneySpendingsView.vue'
import MoneyView from '@/views/MoneyView.vue'
import AccountView from '@/views/AccountView.vue'
import AccountsView from '@/views/AccountsView.vue'
import MoneyCategoriesView from '@/views/MoneyCategoriesView.vue'
import MoneyChartsView from '@/views/MoneyChartsView.vue'
import { sameScreen, watchBrowserAnimatedBack } from '@/transitions'

/**
 * The five sections of the tab bar. «advice» is home (MOL-128): at the shelf a person reads, at
 * home they write — so the app opens on «Что брать», and «Покупки» is where the writing is.
 */
export type Tab = 'advice' | 'purchases' | 'verdicts' | 'money' | 'settings'

export type RouteName =
  | 'advice'
  | 'purchases'
  | 'purchase-manual'
  | 'verdicts'
  | 'money'
  | 'money-spendings'
  | 'money-categories'
  | 'money-charts'
  | 'money-accounts'
  | 'money-account'
  | 'settings'
  | 'exchange'
  | 'incomes'
  | 'devices'
  | 'item-search'
  | 'purchase'
  | 'finished-search'
  | 'privacy'
  | 'kit'

declare module 'vue-router' {
  interface RouteMeta {
    /** The dictionary key of the screen's title: its heading, the back label, the tab title. */
    titleKey: string
    /** Set on a section; the tab bar is shown only there. */
    tab?: Tab
    /**
     * Set on a nested screen. The back chevron is labelled with the parent's title and leads
     * to it, so no screen has to know where it was opened from.
     */
    parent?: RouteName
    /**
     * Other screens this one may be opened from and lead back to, named by `?from=` — a finished
     * trip opened from «Деньги» says «‹ Деньги» (MOL-82, В-3). Listed, so an address cannot make
     * just any screen the parent.
     */
    from?: readonly RouteName[]
    /**
     * Drawn without a session: `App.vue` puts the login screen in front of every other route
     * (MOL-56). Only what is read before deciding to sign in may carry it — today «Данные и
     * приватность» alone (MOL-58).
     */
    public?: boolean
  }
}

// Not lazy: nine small screens, and a chunk per route would turn the first tap on a tab into
// a network request exactly where the connection drops.
export const routes = [
  {
    path: '/settings',
    name: 'settings',
    component: SettingsView,
    meta: { titleKey: 'settings.title', tab: 'settings' },
  },
  // Moved to «Деньги» (MOL-81): a bookmark or the history of an installed app still arrives.
  { path: '/settings/exchange', redirect: { name: 'exchange' } },
  { path: '/settings/incomes', redirect: { name: 'incomes' } },
  {
    path: '/settings/devices',
    name: 'devices',
    component: DevicesView,
    meta: { titleKey: 'devices.title', parent: 'settings' },
  },
  {
    path: '/',
    name: 'advice',
    component: AdviceView,
    meta: { titleKey: 'advice.title', tab: 'advice' },
  },
  // «Что брать» became home and «Поход» became «Покупки» (MOL-128): a bookmark or the history of
  // an installed app still arrives, for good (MOL-81).
  { path: '/advice', redirect: { name: 'advice' } },
  {
    path: '/purchases',
    name: 'purchases',
    component: PurchasesView,
    meta: { titleKey: 'purchases.title', tab: 'purchases' },
  },
  // The record typed by hand, the screen that was «Поход» with a trip going on. Before the
  // records by id, though a static segment outranks a parameter anyway.
  {
    path: '/purchases/manual',
    name: 'purchase-manual',
    component: TripView,
    meta: { titleKey: 'trip.title', parent: 'purchases' },
  },
  {
    path: '/purchases/manual/add',
    name: 'item-search',
    component: ItemSearchView,
    meta: { titleKey: 'item.search_title', parent: 'purchase-manual' },
  },
  {
    path: '/purchases/:tripId',
    name: 'purchase',
    component: FinishedTripView,
    meta: {
      titleKey: 'trip.history.finished_title',
      parent: 'purchases',
      from: ['money', 'money-spendings'],
    },
  },
  {
    path: '/purchases/:tripId/add',
    name: 'finished-search',
    component: ItemSearchView,
    meta: { titleKey: 'item.search_title', parent: 'purchase' },
  },
  { path: '/trip', redirect: { name: 'purchases' } },
  { path: '/trip/add', redirect: { name: 'item-search' } },
  { path: '/trip/history', redirect: { name: 'purchases' } },
  {
    path: '/trip/history/:tripId',
    redirect: (to) => ({ name: 'purchase', params: to.params, query: to.query }),
  },
  {
    path: '/trip/history/:tripId/add',
    redirect: (to) => ({ name: 'finished-search', params: to.params }),
  },
  {
    path: '/verdicts',
    name: 'verdicts',
    component: VerdictsView,
    meta: { titleKey: 'verdict.title', tab: 'verdicts' },
  },
  // The month is in the address (`?month=2026-09`) and changes by `replace` (MOL-82).
  {
    path: '/money',
    name: 'money',
    component: MoneyView,
    meta: { titleKey: 'spending.title', tab: 'money' },
  },
  // «Траты» (MOL-159): the journal of the month «Деньги» has open, the month in the same address.
  {
    path: '/money/spendings',
    name: 'money-spendings',
    component: MoneySpendingsView,
    meta: { titleKey: 'spending.list.title', parent: 'money' },
  },
  {
    path: '/money/exchange',
    name: 'exchange',
    component: ExchangeView,
    meta: { titleKey: 'exchange.title', parent: 'money' },
  },
  {
    path: '/money/incomes',
    name: 'incomes',
    component: IncomesView,
    meta: { titleKey: 'income.title', parent: 'money' },
  },
  // «Графики» (MOL-74, MOL-158): «Месяц · Год» (`?mode=year`), the month (`?month=`) and the
  // category (`?category=`) move by `replace`. The period of MOL-74 (`?period=`) is the year now,
  // so a bookmark of it still opens what it showed (handoff MOL-157 06).
  {
    path: '/money/charts',
    name: 'money-charts',
    component: MoneyChartsView,
    meta: { titleKey: 'spending.charts.title', parent: 'money' },
    beforeEnter: (to) => {
      if (to.query.period === undefined) return true
      const kept = Object.entries(to.query).filter(([name]) => name !== 'period')
      return { ...to, query: { ...Object.fromEntries(kept), mode: 'year' }, replace: true }
    },
  },
  {
    path: '/money/categories',
    name: 'money-categories',
    component: MoneyCategoriesView,
    meta: { titleKey: 'spending.categories.title', parent: 'money' },
  },
  // «Счета» and one account (MOL-123): where the money lies, counted by the server.
  {
    path: '/money/accounts',
    name: 'money-accounts',
    component: AccountsView,
    meta: { titleKey: 'accounts.title', parent: 'money' },
  },
  {
    path: '/money/accounts/:accountId',
    name: 'money-account',
    component: AccountView,
    meta: { titleKey: 'accounts.title', parent: 'money-accounts' },
  },
  // Under the settings, and open without a session: it is read before deciding to sign in (MOL-58).
  {
    path: '/privacy',
    name: 'privacy',
    component: PrivacyView,
    meta: { titleKey: 'privacy.title', parent: 'settings', public: true },
  },
  // Every piece of the kit in every state, and the sheet in a real history — for the eye in both
  // schemes and for the end-to-end tests, before any screen uses them (MOL-18). Development only:
  // in a production build the condition is false, the chunk is never emitted, and the path falls
  // through to home.
  ...(import.meta.env.DEV
    ? [
        {
          path: '/_kit',
          name: 'kit',
          component: () => import('@/views/KitView.vue'),
          meta: { titleKey: 'dev.kit.title', parent: 'advice' },
        } satisfies RouteRecordRaw & { name: RouteName },
      ]
    : []),
  { path: '/:rest(.*)', redirect: '/' },
] satisfies (RouteRecordRaw & { name?: RouteName })[]

// Before the web history exists, so the browser's own back animation is known in time — see
// `watchBrowserAnimatedBack`.
watchBrowserAnimatedBack()

/**
 * Back and forward return to where the person was; any other move to another screen starts at the
 * top. The sections keep no scroll of their own — their state lives in stores, not in components.
 *
 * A move to the same address is not the router's to scroll. It is one of two things. A sheet put
 * away: the sheet puts the page back itself, by the element it was opened from (`putBack` in
 * useSheetHistory.ts); scrolling back to the number saved when it opened moved the list by
 * whatever changed above the screen meanwhile — a list reread, a queued row sent, a notice come or
 * gone — which the browser had already kept out of sight (MOL-63). Or a push to where the router
 * already is: it refuses the duplicate and still asks this function, from the screen to itself.
 *
 * The first navigation is not one of them, though it comes «from» `START_LOCATION`, whose address
 * is «/»: that is the page loaded again — «back» into the app from another site — and the number
 * the router saved on `pagehide` is where the person was. Read as the same address, home, and only
 * home, forgot it (adversarial В1).
 *
 * A move that changes only the query is the screen's own state (`sameScreen`), and the page stays
 * where it is: the person chose the category to look at its chart, three cards down, and the top
 * took it away (MOL-136). The same route with other params is another screen.
 */
export const scrollBehavior: RouterScrollBehavior = (to, from, saved) => {
  if (from === START_LOCATION) return saved ?? { top: 0 }
  if (to.fullPath === from.fullPath) return false
  return saved ?? (sameScreen(from, to) ? false : { top: 0 })
}

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior,
})
