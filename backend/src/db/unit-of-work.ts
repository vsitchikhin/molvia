import { createExpenseRepository } from './expenses-repository'
import type { ExpenseRepository } from './expenses-repository'
import type { Conn, Db } from './index'
import { createItemRepository } from './items-repository'
import type { ItemRepository } from './items-repository'
import { createPlaceRepository } from './places-repository'
import type { PlaceRepository } from './places-repository'
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
}

export function tripRepositories(conn: Conn): TripRepositories {
  return {
    trips: createTripRepository(conn),
    expenses: createExpenseRepository(conn),
    places: createPlaceRepository(conn),
    items: createItemRepository(conn),
    searchPicks: createSearchPickRepository(conn),
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
