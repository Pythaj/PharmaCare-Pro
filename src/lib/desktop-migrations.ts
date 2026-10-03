import { PrismaClient } from '@prisma/client'

/**
 * Additive schema migrations for the packaged desktop app.
 *
 * WHY THIS EXISTS
 * `desktop/main.cjs` provisions a fresh `template.db` on first launch only. An
 * install that already has a `pharmacy.db` keeps it forever, so every schema
 * change shipped in a new build has to be applied to that existing file. Without
 * this, an upgrading desktop install runs new code against an old schema and
 * fails at the first query that touches something new — for `sale_sequences`
 * that is the first sale of the day, i.e. the first thing the app is for.
 *
 * The cloud deployments do not need this: they run `prisma db push` from
 * `scripts/vercel-build.mjs`. Everything here is gated to SQLite and is skipped
 * there.
 *
 * HOW TO USE IT
 * Append a new entry when `prisma/schema.prisma` gains a table, column or index.
 * Never edit or reorder an existing entry — a device that already recorded an id
 * will skip it, so changing the meaning of a shipped id desynchronises installs.
 * Statements must be idempotent (`IF NOT EXISTS`) so a migration that was
 * interrupted part-way can be retried.
 *
 * This is a stopgap. The durable answer is a real `prisma/migrations` history run
 * with `migrate deploy`, which also brings column drops and renames under
 * version control; that is tracked separately. Hand-maintained SQL cannot
 * express "rename this column" and will not notice a removed column at all.
 */

type Migration = {
  /** Stable, immutable identifier. Recorded once the migration has succeeded. */
  id: string
  /** Shown in logs so a failed device says which step it stopped on. */
  description: string
  statements: string[]
}

const MIGRATIONS: Migration[] = [
  {
    id: '2026-10-03-sale-sequences',
    description: 'Per-branch, per-day invoice number high-water mark',
    statements: [
      `CREATE TABLE IF NOT EXISTS "sale_sequences" (
         "date" TEXT NOT NULL,
         "branchId" TEXT NOT NULL,
         "lastNumber" INTEGER NOT NULL DEFAULT 0,
         "updatedAt" DATETIME NOT NULL,
         PRIMARY KEY ("branchId", "date")
       )`,
      `CREATE INDEX IF NOT EXISTS "sale_sequences_date_idx" ON "sale_sequences"("date")`,
    ],
  },
]

const LEDGER = '_desktop_migrations'

/**
 * True when this process is talking to a desktop SQLite database.
 *
 * `DATABASE_PROVIDER` is set by `desktop/main.cjs` in `buildServerEnv`. The
 * probe below backs it up, because the difference between "skip" and "run" is
 * whether a cloud PostgreSQL database gets DDL aimed at it — worth confirming
 * rather than trusting a single env var.
 */
async function isDesktopSqlite(db: PrismaClient): Promise<boolean> {
  if (process.env.DATABASE_PROVIDER !== 'sqlite') return false
  try {
    await db.$queryRawUnsafe('SELECT sqlite_version()')
    return true
  } catch {
    return false
  }
}

/**
 * Applies any desktop migrations this database has not recorded yet.
 *
 * Safe to call on every boot: already-applied ids are skipped, and the whole
 * function is a no-op off the desktop. Each migration runs in its own
 * transaction together with the ledger insert, so a failure leaves the ledger
 * and the schema in agreement rather than marking a half-applied step as done.
 */
export async function ensureDesktopSchema(db: PrismaClient): Promise<void> {
  if (!(await isDesktopSqlite(db))) return

  try {
    await db.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${LEDGER}" (
         "id" TEXT NOT NULL PRIMARY KEY,
         "appliedAt" DATETIME NOT NULL
       )`
    )

    const applied = await db.$queryRawUnsafe(
      `SELECT "id" FROM "${LEDGER}"`
    ) as { id: string }[]
    const done = new Set(applied.map((row) => row.id))

    for (const migration of MIGRATIONS) {
      if (done.has(migration.id)) continue

      await db.$transaction(async (tx) => {
        for (const statement of migration.statements) {
          await tx.$executeRawUnsafe(statement)
        }
        await tx.$executeRawUnsafe(
          `INSERT INTO "${LEDGER}" ("id", "appliedAt") VALUES ($1, $2)`,
          migration.id,
          new Date()
        )
      })

      console.log(`[desktop-migrations] applied ${migration.id} (${migration.description})`)
    }
  } catch (err) {
    // Deliberately non-fatal. A migration failure must not stop the app from
    // launching: the branch may still open, read and print, and a pharmacy
    // losing POS access over a bookkeeping table is a worse outcome than one
    // feature failing loudly on first use. The thrown Prisma error from the
    // actual query is what surfaces to the user.
    console.error('[desktop-migrations] failed to apply schema migrations:', err)
  }
}