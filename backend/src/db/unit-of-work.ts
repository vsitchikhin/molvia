import { createExchangeRepository } from './exchanges-repository'
import type { ExchangeRepository } from './exchanges-repository'
import { createExpenseRepository } from './expenses-repository'
import { createIncomeRepository } from './incomes-repository'
import type { IncomeRepository } from './incomes-repository'
import type { ExpenseRepository } from './expenses-repository'
import type { Conn, Db } from './index'
import { createItemRepository } from './items-repository'
import type { ItemRepository } from './items-repository'
import { createPlaceRepository } from './places-repository'
import type { PlaceRepository } from './places-repository'
import { createRateRepository } from './rates-repository'
import type { RateRepository } from './rates-repository'
import { createSearchPickRepository } from './search-picks-repository'
import type { SearchPickRepository } from './search-picks-repository'
import { createTripRepository } from './trips-repository'
import type { TripRepository } from './trips-repository'

/** What a use case about a trip can reach — the repositories, never the connection. */
export interface TripRepositories {
  readonly trips: TripRepository
  readonly expenses: ExpenseRepository
  readonly places: PlaceRepository
  readonly items: ItemRepository
  readonly searchPicks: SearchPickRepository
  /** Read by «Начать поход» to snapshot the official rate (MOL-39); written by the refresh. */
  readonly rates: RateRepository
  /**
   * The person's exchanges and which rate they want (MOL-40): read by «Начать поход» for their own
   * rate, and the screen of exchanges is built from these and the rates above.
   */
  readonly exchanges: ExchangeRepository
  /** The person's incomes (MOL-66): money that came in moves their own rate too. */
  readonly incomes: IncomeRepository
}

export function tripRepositories(conn: Conn): TripRepositories {
  return {
    trips: createTripRepository(conn),
    expenses: createExpenseRepository(conn),
    places: createPlaceRepository(conn),
    items: createItemRepository(conn),
    searchPicks: createSearchPickRepository(conn),
    rates: createRateRepository(conn),
    exchanges: createExchangeRepository(conn),
    incomes: createIncomeRepository(conn),
  }
}

/**
 * Runs `work` with every repository on one transaction: all of it commits or none of it does.
 *
 * Handed to a use case by the composition point rather than imported by it, so a use case can
 * say «these two writes are one» without seeing SQL or the driver. The first to need it is
 * MOL-21 — an expense and the pick it remembers (MOL-11): a pick without its purchase would lift
 * an item nobody took.
 */
export type Transact = <T>(work: (repositories: TripRepositories) => Promise<T>) => Promise<T>

export function transactOn(db: Db): Transact {
  return (work) => db.transaction((tx) => work(tripRepositories(tx)))
}
