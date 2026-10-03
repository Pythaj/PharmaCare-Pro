/**
 * Runs once when the server process starts.
 *
 * Used only to bring an existing desktop installation's SQLite file up to the
 * current schema. See `src/lib/desktop-migrations.ts` for why that cannot be
 * left to the build.
 */
export async function register() {
  // Instrumentation also runs during `next build`, where there is no database
  // and the Prisma client is a different generated target. Guarding on the
  // server runtime keeps a build from ever connecting to anything.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { db } = await import('@/lib/db')
  const { ensureDesktopSchema } = await import('@/lib/desktop-migrations')
  await ensureDesktopSchema(db)
}