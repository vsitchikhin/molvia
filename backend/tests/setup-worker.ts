import process from 'node:process'
import postgres from 'postgres'
import { testDatabaseUrl } from './db'

/**
 * A database of this worker's own (MOL-164): a copy of the migrated test database, made from it
 * as a template on the worker's first file. The files of one worker run in turn and clean their
 * rows in `beforeEach`, exactly as every file did in the one database when they all ran in turn;
 * two workers never share one, so they no longer delete each other's rows.
 */
const template = new URL((process.env.TEST_TEMPLATE_DATABASE_URL ??= testDatabaseUrl()))
const own = new URL(template.toString())
own.pathname = `${template.pathname}_w${process.env.VITEST_POOL_ID ?? '1'}`

const maintenance = new URL(template.toString())
maintenance.pathname = '/postgres'

const admin = postgres(maintenance.toString(), { max: 1, onnotice: () => undefined })
try {
  const database = own.pathname.slice(1)
  const existing = await admin`select 1 from pg_database where datname = ${database}`
  if (existing.length === 0) {
    await admin.unsafe(`create database "${database}" template "${template.pathname.slice(1)}"`)
  }
} finally {
  await admin.end()
}

process.env.TEST_DATABASE_URL = own.toString()
