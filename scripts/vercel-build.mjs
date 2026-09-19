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

const isCloud = process.env.VERCEL === '1' || process.env.DATABASE_PROVIDER === 'postgresql';

if (isCloud) {
  console.log('[build] Cloud target detected — generating PostgreSQL Prisma client');
  run('prisma generate --schema prisma/schema.postgres.prisma');
} else {
  console.log('[build] Local target detected — generating SQLite Prisma client');
  run('prisma generate');
}

run('next build --webpack');

console.log('\n[build] Post-build safety pass — materialising Prisma junctions if present');
run('node scripts/fix-turbopack-junctions.mjs');

console.log('\n[build] Done.');