// Minimal reproduction: payload.db.commitTransaction() resolves when Postgres refuses the COMMIT.
// Usage: node repro.mjs [connection string]
import { buildConfig, getPayload } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { sql } from 'drizzle-orm'

const connectionString =
  process.argv[2] || process.env.DATABASE_URL || 'postgresql://postgres:repro@127.0.0.1:55432/postgres'

const unhandled = []
process.on('unhandledRejection', (err) => unhandled.push(err))

const config = await buildConfig({
  secret: 'repro-only-secret-0123456789abcdef',
  collections: [],
  telemetry: false,
  db: postgresAdapter({ pool: { connectionString }, push: false }),
})
const payload = await getPayload({ config })

const rows = async () =>
  Number((await payload.db.drizzle.execute(sql`select count(*)::int as n from probe`)).rows[0].n)

await payload.db.drizzle.execute(sql`drop table if exists probe`)
await payload.db.drizzle.execute(
  sql`create table probe (n int, constraint probe_u unique (n) deferrable initially deferred)`,
)

// Control: a commit that succeeds.
{
  const id = await payload.db.beginTransaction()
  const tx = payload.db.sessions[id].db
  await tx.execute(sql`insert into probe (n) values (100)`)
  await payload.db.commitTransaction(id)
  console.log('control, valid commit: resolved, rows =', await rows())
  await payload.db.drizzle.execute(sql`delete from probe`)
}

// The bug: the deferred unique constraint makes Postgres refuse the COMMIT (23505).
{
  const id = await payload.db.beginTransaction()
  const tx = payload.db.sessions[id].db
  await tx.execute(sql`insert into probe (n) values (1)`)
  await tx.execute(sql`insert into probe (n) values (1)`)
  let outcome
  try {
    await payload.db.commitTransaction(id)
    outcome = 'RESOLVED with no error (expected: rejects with 23505)'
  } catch (err) {
    outcome = `rejected: ${err?.code ?? ''} ${err?.message ?? err}`
  }
  console.log('refused COMMIT: commitTransaction', outcome)
  console.log('rows in probe afterwards =', await rows(), '(0 = the transaction was rolled back)')
}

await new Promise((resolve) => setTimeout(resolve, 300))
console.log('unhandled rejections:', unhandled.length)
await payload.db.drizzle.execute(sql`drop table if exists probe`)
process.exit(0)
