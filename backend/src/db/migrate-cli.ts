import process from 'node:process'
import { describeMigrationFailure } from './failure'
import { migrateToLatest } from './migrate'

// `make migrate` and `make up` go through the same code the API runs at boot, so a
// migration cannot behave one way locally and another way in production.
try {
  await migrateToLatest()
} catch (error) {
  // Told as the API logs it at boot, never as Node prints a rejection: whole, with the cause whose
  // message holds the value a cast refused — a person's row (MOL-153, adversarial И).
  console.error('migrations failed', describeMigrationFailure(error))
  process.exit(1)
}
console.log('migrations applied')
