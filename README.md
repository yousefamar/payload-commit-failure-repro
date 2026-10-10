# payload-commit-failure-repro

Minimal reproduction for a Payload v3 bug: with the Postgres adapter, `payload.db.commitTransaction(id)` resolves when Postgres refuses the COMMIT. Nothing is thrown and nothing is logged, the rows are rolled back, and the caller continues as if they were saved.

## Run it

```bash
docker run -d --rm --name payload-repro-pg -e POSTGRES_PASSWORD=repro -p 127.0.0.1:55432:5432 postgres:17
npm install
node repro.mjs            # or: node repro.mjs postgresql://user:pass@host:5432/db
docker rm -f payload-repro-pg
```

The script needs no Payload project: it builds a config with no collections, opens a transaction through `payload.db`, and commits it. It creates and drops one table named `probe`.

## Output

Actual, on `payload` 3.90.2, `@payloadcms/db-postgres` 3.90.2, `@payloadcms/drizzle` 3.90.2, `drizzle-orm` 0.45.2, `pg` 8.20.0, Node 22.20.0, Postgres 17.11:

```text
control, valid commit: resolved, rows = 1
refused COMMIT: commitTransaction RESOLVED with no error (expected: rejects with 23505)
rows in probe afterwards = 0 (0 = the transaction was rolled back)
unhandled rejections: 0
```

Expected: `commitTransaction` rejects with the commit error (`23505`, duplicate key value violates unique constraint "probe_u").

## Where it comes from

- `packages/drizzle/src/transactions/beginTransaction.ts` attaches a `.catch()` to the promise returned by `this.drizzle.transaction(...)`, so that promise can never reject.
- `packages/drizzle/src/transactions/commitTransaction.ts` awaits it inside `try { await session.resolve() } catch (_) { await session.reject() }`, so the commit error has nowhere to go.
