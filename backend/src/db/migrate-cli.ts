import { migrateToLatest } from './migrate'

// `make migrate` and `make up` go through the same code the API runs at boot, so a
// migration cannot behave one way locally and another way in production.
await migrateToLatest()
console.log('migrations applied')
