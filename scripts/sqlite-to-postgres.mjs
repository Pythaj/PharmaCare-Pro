/**
 * sqlite-to-postgres.mjs — one-shot data migration for PharmaCare Pro.
 *
 * Copies every row from the SQLite database (local/desktop) into the hosted
 * PostgreSQL database used by the Vercel/Netlify deployment. Cuid primary keys
 * are preserved 1:1, so all foreign-key relationships survive the move.
 *
 * Requirements:
 *   - prisma generate has run with prisma/schema.prisma (SQLite client) —
 *     that client is used to read from the source file.
 *   - The PostgreSQL schema must already exist: run `npm run db:push:pg`
 *     first (mlens: prisma db push --schema prisma/schema.postgres.prisma).
 *
 * Usage (from repo root):
 *   $env:SRC_DATABASE_URL="file:D:/PROJECTS BUILD/RAW FILES/PHARMACY MANAGEMENT SYSTEM APP/prisma/db/dev.db"
 *   $env:TARGET_DATABASE_URL="postgresql://user:pass@host:5432/pharmacare?schema=public"
 *   node scripts/sqlite-to-postgres.mjs [--truncate]
 *
 * `--truncate` wipes the PostgreSQL tables (CASCADE) before re-inserting, so
 * the script is safe to re-run for a clean, idempotent sync.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---- minimal .env loader (Prisma CLI does this for us too, but be explicit) ----
function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue; // real env wins
    process.env[key] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

// ---- config ----
const SRC = process.env.SRC_DATABASE_URL || process.env.DATABASE_URL;
const TARGET = process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL;
const TRUNCATE = process.argv.includes('--truncate');

if (!SRC || !SRC.startsWith('file:')) {
  console.error('[abort] Source DATABASE_URL must be a SQLite file: URL. Set SRC_DATABASE_URL.');
  process.exit(1);
}
if (!TARGET || !TARGET.startsWith('postgres')) {
  console.error('[abort] Target DATABASE_URL must be a postgres:// URL. Set TARGET_DATABASE_URL.');
  process.exit(1);
}

// Tables in foreign-key-safe insertion order. Uses the @@map names shared by
// both schemas (prisma/schema.prisma and prisma/schema.postgres.prisma).
const TABLES = [
  'users',
  'categories',
  'suppliers',
  'products',
  'purchases',
  'batches',
  'customers',
  'sales',
  'sale_items',
  'returns',
  'return_items',
  'audit_logs',
  'daily_sales_records',
  'system_settings',
];

function toValue(v) {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

async function main() {
  console.log(`[migration] source : ${SRC}`);
  console.log(`[migration] target : ${TARGET}`);

  const prisma = new PrismaClient();
  const pool = new pg.Pool({ connectionString: TARGET, max: 4 });

  try {
    const client = await pool.connect();
    const totals = {};

    if (TRUNCATE) {
      console.log('[migration] --truncate: clearing existing PostgreSQL tables (CASCADE)...');
      for (const t of TABLES) await client.query(`TRUNCATE TABLE "${t}" CASCADE`);
    }

    await client.query('BEGIN');

    for (const table of TABLES) {
      const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "${table}"`);
      const count = Array.isArray(rows) ? rows.length : 0;
      totals[table] = count;
      if (count === 0) continue;

      const cols = Object.keys(rows[0]);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const quoted = cols.map((c) => `"${c}"`);
      const sql = `INSERT INTO "${table}" (${quoted.join(', ')}) VALUES (${placeholders})`;

      for (const row of rows) {
        const values = cols.map((c) => toValue(row[c]));
        await client.query(sql, values);
      }
      console.log(`[migration] ${table.padEnd(22)} ${count} row(s)`);
    }

    await client.query('COMMIT');
    client.release();
    await pool.end();

    console.log('\n[migration] Done. Table totals:');
    for (const [t, n] of Object.entries(totals)) console.log(`  ${t.padEnd(22)} ${n}`);
  } catch (err) {
    console.error('\n[migration] FAILED — rolling back this run:', err.message);
    try {
      const c = await pool.connect();
      await c.query('ROLLBACK');
      c.release();
    } catch {
      /* pool may already be gone */
    }
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
    await prisma.$disconnect().catch(() => {});
  }
}

main();