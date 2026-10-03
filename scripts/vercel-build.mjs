/**
 * Provider-aware build runner used as the primary `npm run build` command.
 *
 * Detects the deployment target and switches the Prisma client accordingly:
 *  - Vercel / any `DATABASE_PROVIDER=postgresql` build → generate the client
 *    from prisma/schema.postgres.prisma (cloud PostgreSQL, required because
 *    serverless filesystems cannot persist SQLite).
 *  - Everything else (local) -> default prisma/schema.prisma (SQLite).
 *
 * Uses `next build --webpack` so Prisma resolves through classic externals,
 * avoiding the Turbopack hashed-alias/junction issue that the Netlify setup
 * hit (see netlify.toml and scripts/fix-turbopack-junctions.mjs). The junction
 * maintenance script is then run as a safety net — it is a no-op when no
 * links are present.
 *
 * DATABASE MUTATION IS GATED — READ THIS BEFORE ADDING A STEP
 *
 * Everything below the `shouldPushSchema` guard writes to the live database:
 * `db push` applies DDL, the archive step copies money columns, and the
 * backfills insert rows. That is correct for a production deploy and actively
 * dangerous everywhere else.
 *
 * It used to run on EVERY cloud build, because the only test was
 * `VERCEL === '1'`, which is true for previews too. Vercel builds a preview for
 * every push to every branch and every opened pull request, and a preview
 * inherits `DATABASE_URL` from the project. So checking out a branch and opening
 * a PR silently applied that branch's schema to production, archived live money
 * columns, and inserted backfill rows — from a machine that was only supposed to
 * typecheck the change. Whether it breaks depends entirely on whether the
 * preview env var points at production, which is exactly the kind of thing that
 * is true until the day it is not.
 *
 * `shouldPushSchema` therefore requires an actual production deploy, and
 * previews get a client but no writes. See that constant for the full rule.
 */
import { spawnSync } from 'node:child_process';

const run = (command) => {
  console.log(`\n> ${command}\n`);
  const res = spawnSync(command, { stdio: 'inherit', shell: true });
  if (res.status !== 0) {
    console.error(`\n[x] Command failed: ${command}`);
    process.exit(res.status ?? 1);
  }
  return res;
};

const isVercel = process.env.VERCEL === '1';
const isCloud = isVercel || process.env.DATABASE_PROVIDER === 'postgresql';

/**
 * Whether this build may write to the database.
 *
 * The rule, in order:
 *  1. `ALLOW_SCHEMA_PUSH` explicitly overrides everything. Escape hatch for CI
 *     that has already isolated its own database, and for a deliberate
 *     one-off repair run.
 *  2. On Vercel, ONLY `VERCEL_ENV === 'production'`. Preview and development
 *     builds get a Prisma client and nothing else. Vercel does not populate
 *     `VERCEL_ENV` for local `vercel dev`, so an unset value falls through to
 *     the postgres check rather than defaulting to writing.
 *  3. Off Vercel, a PostgreSQL target keeps the previous behaviour and pushes.
 *     That is a self-hosted or container build against a database the operator
 *     chose, where skipping the push would just produce a stale schema.
 *
 * Anything else — no provider, or SQLite — generates a local client and stops.
 */
const shouldPushSchema =
  process.env.ALLOW_SCHEMA_PUSH === '1' ||
  (isVercel ? process.env.VERCEL_ENV === 'production' : process.env.DATABASE_PROVIDER === 'postgresql');

if (isCloud) {
  console.log('[build] Cloud target detected — generating PostgreSQL Prisma client');
  run('prisma generate --schema prisma/schema.postgres.prisma');

  if (!shouldPushSchema) {
    /* Say it loudly and name the reason. A silent skip is how this becomes a
       bug report months later ("the preview build didn't migrate"), and the
       whole point of the guard is that the decision is deliberate. */
    console.log(
      `\n[build] NOT applying schema to the database.\n` +
        `[build]   Vercel environment : ${process.env.VERCEL_ENV ?? '(unset)'}\n` +
        `[build]   Reason             : only a production deploy may migrate the database.\n` +
        `[build] This build will produce a Prisma client against the current schema.\n` +
        `[build] If it is run against a database that is behind, that is expected.\n`
    );
  } else {
    if (!process.env.DATABASE_URL) {
      /* Fail loudly rather than letting `prisma db push` resolve some ambient
         default. `db push` has no interactive confirmation in CI, so a missing
         URL can otherwise surface as an error deep inside Prisma with none of
         this context. */
      console.error('[build] DATABASE_URL is not set — cannot apply schema.');
      process.exit(1);
    }

    // MUST run before `prisma db push`. `db push` cannot add a NOT NULL column
    // to a table that already has rows: PostgreSQL rejects it with "column
    // contains null values" and the deploy fails. The multi-branch schema makes
    // `branchId` required on batches/sales/purchases/daily records, so any
    // pre-branch production data has to be given a branch first.
    //
    // The file ends in a preflight that RAISEs if the new unique keys would be
    // violated, so reaching db push means those two constraints are verified
    // safe rather than merely assumed. That is what makes the --accept-data-loss
    // below defensible: db push always warns when adding a unique constraint,
    // and here we have already proved there are no duplicates to lose.
    //
    // Deliberately fatal on error. If this cannot run, pushing the schema
    // anyway would fail too, and aborting here leaves the live database exactly
    // as it was rather than half-migrated.
    console.log('[build] Backfilling pre-branch data with a default branch');
    run('prisma db execute --schema prisma/schema.postgres.prisma --file scripts/backfill-branch.sql');

    // MUST also run before `prisma db push`, and for a different reason: db push
    // DROPs the retired `sales.tax`, `sales.discount` and
    // `daily_sales_records.totalDiscount` columns, and those hold real historical
    // money figures on every sale rung before tax/discount was removed. The
    // --accept-data-loss below is required for the unique keys, and without this
    // step it would silently authorise destroying them as well.
    //
    // So this copies every non-zero figure into two @@ignore()d tables first, then
    // asserts the copy is complete. Nothing is destroyed; if the archive cannot be
    // proven complete the build stops with the columns still in place, because a
    // failure here means db push has not run yet.
    console.log('[build] Archiving the retired tax/discount figures before they are dropped');
    run('prisma db execute --schema prisma/schema.postgres.prisma --file scripts/archive-legacy-money.sql');

    console.log('[build] Applying schema to cloud database (prisma db push)');
    run('prisma db push --schema prisma/schema.postgres.prisma --skip-generate --accept-data-loss');

    // MUST run AFTER db push. This inserts the quantity-0 starter batches that
    // make every product reachable from every active branch, and it relies on both
    // the NOT NULL branchId and the compound unique
    // (productId, batchNumber, branchId) that db push has just created.
    //
    // Additive and idempotent: no DELETE, no DROP, existing batches are never
    // updated, and a second run inserts nothing. It ends in a verification block
    // that RAISEs if any product/branch pair is still uncovered, so a silent
    // partial repair fails the deploy instead of shipping a drug that is missing
    // from a till.
    console.log('[build] Backfilling catalogue coverage across all active branches');
    run('prisma db execute --schema prisma/schema.postgres.prisma --file scripts/backfill-catalogue.sql');
  }
} else {
  console.log('[build] Local target detected — generating SQLite Prisma client');
  run('prisma generate');
}

run('next build --webpack');

console.log('\n[build] Post-build safety pass — materialising Prisma junctions if present');
run('node scripts/fix-turbopack-junctions.mjs');

console.log('\n[build] Done.');